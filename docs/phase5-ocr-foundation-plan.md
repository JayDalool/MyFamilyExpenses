# Phase 5 — OCR Foundation + PaddleOCR Plan (rev. 2, post-Codex review)

Status: **OCR contract foundation + PaddleOCR scaffold implemented; no OCR
persistence, no OCR migrations yet.** The engine/parser boundary, the
provider-neutral score normalization, fail-closed provider selection, and the
internal extraction envelope exist in `lib/ocr`. An **experimental** PaddleOCR
path now exists too: the Next engine (`lib/ocr/paddle-ocr-engine.ts`), the
internal FastAPI sidecar (`services/paddle-ocr`), and opt-in Docker wiring
(`docker-compose.ocr.yml`). Production default remains `OCR_PROVIDER=tesseract`.
Persistence (`ReceiptExtractionAttempt` / `ReceiptExtraction`), the
upload/review UI, and OCR-output persistence remain deferred.
Codex verdict on rev. 1: GO with changes. Categories UI cleanup may proceed
immediately; OCR schema/service work is NO-GO until the four blockers below are
resolved in the design. This revision resolves them at the plan level.

Out of scope / unchanged by this phase: auth, paid-by logic, reports
calculations, dashboard, PDF exports, expense create/edit business logic,
budgets, subscriptions.

---

## 1. Current state (verified in code)

- Engine/parser seam exists: `lib/ocr/ocr.service.ts` resolves the engine from
  `OCR_PROVIDER` when OCR is invoked (not at app startup). Allowed values are an
  explicit allowlist — `tesseract` (default), `mock` (local/test/dev only,
  hard-blocked in production), and `paddle` (experimental; requires
  `OCR_SERVICE_URL` or it fails closed at selection time). An unknown
  `OCR_PROVIDER` (e.g. `paddleocr` — the canonical name is `paddle`) **fails
  closed** with an `OcrConfigError`; it does **not** fall back to mock.
- Engines are recognition-only and return a provider-neutral `EngineResult`
  (`rawText`, `blocks`, `meanScore`, `provider`, `modelVersion`, `durationMs`),
  with `meanScore` and block scores normalized to 0–1 **at the engine boundary**
  (`lib/ocr/normalize.ts`). Engines: `TesseractOcrEngine`
  (`lib/ocr/tesseract-ocr-engine.ts`, in-process WASM, images only, throws
  `PDF_NOT_SUPPORTED`), `MockOcrEngine` (`lib/ocr/mock-ocr-engine.ts`,
  synthetic text), and `PaddleOcrEngine` (`lib/ocr/paddle-ocr-engine.ts`,
  **experimental** HTTP client to the internal sidecar; image-only; Zod-validated
  response; 5–8 s timeout). Engines do **not** produce structured fields.
- The Node-owned `ReceiptParser` (`lib/ocr/ocr-parsing.ts`,
  `parseInvoiceFieldsFromText`) turns `rawText` into **structured fields**
  (`invoiceNumber`, `invoiceDate`, `amount` + per-field confidence). This is the
  asset to preserve. The orchestrator (`runExtraction`) bundles
  `engineResult` + `parserResult` + the UI `response` into an internal
  `OcrExtractionEnvelope` (in-memory only — not persisted yet).
- Flow: wizard → `POST /api/expenses/extract` (validate file, OCR, return JSON
  to browser; nothing persisted) → user reviews/edits in browser →
  `POST /api/expenses` (re-runs OCR only when fields are missing; saves expense
  + file). OCR is best-effort; manual entry always works.
- Upload safety today: MIME allowlist (PDF/PNG/JPG/WEBP), magic-byte sniffing,
  declared-vs-detected mismatch check, `MAX_UPLOAD_MB` (default 10). Storage
  uses random UUID filenames under `UPLOAD_DIR`; file serving is
  household-scoped and basename-only (path-traversal safe) but lacks
  `X-Content-Type-Options: nosniff`. No rate limiting on `/extract`.
- No DB persistence of OCR output (status/raw/confidence/review do not exist).

## 2. Blocker A — trusted pre-save OCR handoff

Problem: the browser currently carries OCR output between `/extract` and save.
Anything persisted as "what OCR said" must never be browser-supplied, or users
could tamper with provenance/confidence data.

**Decision (MVP): short-lived server-side `ReceiptExtractionAttempt`.**

- Written by the server inside `/api/expenses/extract` after a successful (or
  failed) recognition. The browser receives only the extraction preview
  (`envelope.response`) plus an opaque `attemptId`.
- Contains OCR output only — **never the uploaded file bytes**.
- **Tenant-safe**: every attempt is scoped to `userId` + `householdId`, and a
  **composite membership FK `(userId, householdId)` → `Membership(userId,
  householdId)`** (mirroring the existing expense/category tenant-integrity FKs)
  guarantees an attempt can only ever belong to a real member of that household.
  Lookups at consumption time are filtered by the requester's `userId` +
  active `householdId`, so one household can never consume another's attempt.
- **Single-use**: an attempt can be consumed at most once. Adds `consumedAt`
  (nullable) and `consumedByExpenseId` (nullable, unique) so a consumed attempt
  cannot be replayed into a second expense.
- Fields: `id`, `userId`, `householdId`, `fileSha256`, `provider`,
  `modelVersion`, `parserVersion`, `rawText`, `layout` (JSON), `extracted`
  (JSON), `confidence` (JSON), `errorCode`, `durationMs`, `createdAt`,
  `expiresAt`, `consumedAt`, `consumedByExpenseId`.
- Expiry: short (proposed 30–60 min — open question H1). Expired/missing
  attempts are ignored.
- **Atomic one-time consumption at save**: inside the expense-create
  transaction, the server claims the attempt with a **conditional update**
  (`WHERE id = ? AND userId = ? AND householdId = ? AND consumedAt IS NULL AND
  expiresAt > now()` → set `consumedAt`, `consumedByExpenseId`) and also
  verifies `fileSha256` matches the uploaded file. Only a claim that affects
  exactly one row may be copied into the final `ReceiptExtraction`. A
  zero-row claim (missing / expired / already-consumed / wrong tenant /
  hash mismatch) ⇒ save proceeds as a **manual** entry (`SKIPPED` / `MANUAL`),
  never a hard failure. This prevents races and double-consumption.
- Cleanup job/policy deletes expired/consumed attempts (see §5 retention).

## 3. Blocker B — provider seam refactor (two boundaries)

Refactor internals into two contracts; **route/service behavior visible to the
UI stays identical**.

1. **`OcrEngine`** — recognition only, provider-neutral DTO:
   `{ rawText, blocks: [{ text, bbox, score }], meanScore, provider,
   modelVersion, durationMs }`.
   Engines: `tesseract` and `mock` exist today; `paddle` (HTTP sidecar) is
   **planned/future**. The Paddle service will return this DTO shape (validated),
   **not** native Paddle JSON.
2. **`ReceiptParser`** — Node-owned, versioned (`parserVersion`): turns
   `rawText` (+layout later) into structured candidates — invoice number,
   date, amount (merchant/tax later) — with per-field confidence. This is the
   existing `parseInvoiceFieldsFromText`, lifted to the formal boundary.

`extractInvoiceData()` keeps its signature (engine → parser → existing
`OcrResult`), so the wizard and both routes do not change in this refactor.

**Internal extraction envelope.** The orchestrator (`runExtraction`) bundles the
two boundaries plus the UI projection into one internal object:

```
OcrExtractionEnvelope = {
  engineResult: EngineResult,   // provider-neutral recognition (rawText, blocks,
                                // meanScore, provider, modelVersion, durationMs)
  parserResult: OcrResult,      // Node ReceiptParser structured fields + confidence
  response:     OcrResult,      // exactly what the wizard sees today (UI projection)
}
```

The envelope is **internal only** and **not persisted yet**. It is the single
seam that a trusted, server-persisted `ReceiptExtractionAttempt` (Blocker A) will
later hang off: `engineResult`/`parserResult` populate the attempt server-side,
while `response` is the only part returned to the browser.

**Status of this step:** the contract refactor (engine boundary, parser
ownership, envelope, fail-closed provider selection, mock-prod prohibition) is
**implemented now**, and an **experimental** Paddle engine + sidecar + opt-in
Docker wiring now exist against this same contract. Persistence and attempts
remain deferred.

## 4. Blocker C — unknown/mock provider safety (fail closed)

**Status: implemented** (`resolveOcrProviderName` in `lib/ocr/ocr.service.ts`).

- Validation happens **when OCR is invoked** (lazily, on first extraction), not
  at app startup. An unknown `OCR_PROVIDER` value ⇒ **`OcrConfigError`
  (fail closed)** — no silent fallback to mock. A typo like `paddleocr` must
  never fabricate financial data.
- `MockOcrEngine` is **prohibited when `NODE_ENV=production`** — selecting it
  there is also a hard config error.
- Allowed values are an explicit allowlist: **`tesseract`**, **`mock`
  (local/test/dev only)**, and **`paddle`** (experimental). The canonical Paddle
  name is `paddle`; **`paddleocr` is not an alias** and fails closed. Selecting
  `paddle` without `OCR_SERVICE_URL` is also a hard config error (fail closed).

## 5. Blocker D — security & resource requirements (before any Paddle work)

Rate/resource limits
- Dedicated OCR rate limits: **per-user** and **per-household** (reuse the
  existing rate-limit table pattern; new action keys).
- **OCR concurrency limit** in Node (small semaphore) so a burst can't pile
  onto the engine.
- **Total OCR budget 5–8 s including fallback** (open question H3): Paddle gets
  the first slice; fallback only runs inside the remaining budget.
- Fallback policy: Paddle → Tesseract **only on timeout / network error / 5xx**
  — never on invalid-file errors (those return 4xx to the user). During a
  Paddle outage, Tesseract fallback is **bounded by the same rate/concurrency
  limits** (no unlimited fallback stampede).

Input hardening (Node side, before engine)
- Keep magic-byte validation + size limits.
- Add **image dimension / pixel-count limits** (decompression-bomb guard)
  before sending bytes to any engine.

Engine response hardening
- **Zod-validate** the Paddle service response (the §3 DTO).
- Enforce **max response body size**, **max rawText length**, **max block
  count**; truncate/fail closed beyond limits.
- **Never log** raw OCR text, file bytes, or full service responses (log
  ids/sizes/durations/error codes only).

File serving / storage
- `X-Content-Type-Options: nosniff` is **already applied globally** by the
  middleware (`proxy.ts` sets it on every response). No change is required for
  the file route; future work here is only **verification** (a test asserting
  the header is present on `/api/expenses/[id]/file`) and, optionally,
  **route-level defense-in-depth** (setting it directly on the file response so
  it survives any future middleware-matcher change).
- Retention policy for `rawText`/`layout` (open questions H2/H7) and a cleanup
  policy for expired/consumed `ReceiptExtractionAttempt` rows.

Docker / network
- Paddle service on the **internal Docker network only**; **no public port**.
- **No uploads volume mounted into Paddle** — bytes are passed per-request.
- Container runs **non-root** if practical; CPU/memory limits and service-side
  concurrency limits set in Compose.

## 6. Final `ReceiptExtraction` data model (proposed; migration deferred)

Linked to `Expense` only (1:1). Authoritative financial values remain **typed
columns on `Expense`**; OCR predictions stay JSON because their shape will
evolve (hence `schemaVersion`).

| Field | Notes |
|---|---|
| `id` | PK |
| `householdId` | tenant isolation at DB level |
| `expenseId` | **unique**; composite FK `(expenseId, householdId)` → Expense (mirrors existing tenant-integrity FKs) |
| `provider`, `modelVersion`, `parserVersion`, `schemaVersion` | provenance |
| `status` | `SUCCEEDED / PARTIAL / FAILED / SKIPPED` |
| `rawText` (nullable), `layout` JSON (nullable) | subject to retention policy |
| `extracted` JSON (nullable), `confidence` JSON (nullable) | parser output |
| `reviewStatus` | `UNCHANGED / CORRECTED / MANUAL` |
| `correctedFields` JSON (nullable), `reviewedByUserId` (nullable), `reviewedAt` (nullable) | review trail |
| `errorCode` (nullable), `durationMs` (nullable) | diagnostics |
| `fileSha256` | links result to the exact uploaded bytes |
| `createdAt`, `updatedAt` | timestamps |

Indexes: `(householdId, createdAt)`, `(provider, status, createdAt)`, plus
expiry-timestamp indexes on the attempt table for cleanup.

## 7. Explicitly deferred

Budgets; subscription/billing; job queues; multiple receipts per expense;
pending-upload table holding file storage; PDF OCR (unless trivially stable
later); category hints; merchant/tax editable UI (until persistence design
lands); HEIC support (unless approved — H5).

## 8. Implementation order (revised per Codex)

1. **Categories UI cleanup** — separate small commit (done in this branch).
2. OCR contract refactor: `OcrEngine` DTO + `ReceiptParser` boundary (+ fail-
   closed provider selection from §4). **(done)**
3. OCR rate limits, resource protections, security hardening (incl. nosniff).
4. Trusted `ReceiptExtractionAttempt` handoff.
5. Final `ReceiptExtraction` schema/persistence — exercised with **mock /
   Tesseract only**.
6. Upload/review UI additions (only after persistence exists).
7. PaddleOCR service + provider + Docker integration. **(scaffolded early,
   experimental — engine, sidecar, and opt-in Compose override exist; model not
   yet load-tested; brought forward ahead of steps 3–6, which remain open).**
8. Tests + deployment verification per chunk.

## 9. Open questions (for product owner)

1. How long should `ReceiptExtractionAttempt` rows live before expiry? (proposal: 30–60 min)
2. How long should `rawText`/`layout` be retained after review? (e.g., 90 days → strip raw, keep metrics)
3. Confirm 5–8 s as the total OCR budget including fallback?
4. What OCR concurrency can the production home server safely support? (proposal: 1–2)
5. Should HEIC images be supported (iPhone default)?
6. Should failed/manual attempts create final `ReceiptExtraction` rows (status `FAILED`/`SKIPPED`) for metrics, or only successes?
7. Should raw text be deleted after review while keeping confidence/metrics?
8. Exact PaddleOCR + model version to pin in the Docker image?
