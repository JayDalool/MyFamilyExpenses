# Phase 6 — OCR Intelligence Plan

Status: **Stage A + A.2 implemented (library only). Phase B (extraction
attempts) and Phase C (correction feedback) implemented and persisted. Phase D.1
(internal learning insights), Phase D.2 (internal template review/draft workflow),
Phase D.3A (static template simulation / dry-run), and Phase D.3B (guarded static
template application) implemented — no migration for D.1/D.2/D.3A/D.3B.** Phase D.4
(more approved merchant templates) and Phase E are designed but not built.

## What we are (and are not) building

We are **not** building an end-user OCR analytics feature. Regular users only
care that receipt upload works, the amount/date/merchant are filled correctly,
they can save faster, and mistakes are easy to fix. They will never understand or
want correction rates, parser strategies, or template recommendations.

We **are** building an **internal OCR intelligence pipeline**: store what OCR
saw, learn where it is wrong, let an owner/admin review that, and turn it into
human-reviewed static templates that improve autofill safely. The diagnostics
surface is hidden from normal navigation and gated to OWNER/ADMIN.

### Phase B — Extraction Attempt Memory (`ReceiptExtractionAttempt`)
Store short-lived OCR extraction attempts so OCR output survives long enough to
compare against the final saved expense. **Not user-facing.** Migration
`20260611000001`.

### Phase C — Correction Feedback (`ReceiptCorrectionFeedback`)
Store durable predicted-vs-final correction data — what OCR got right or wrong.
**Not user-facing** except indirectly, later, through better autofill. Migration
`20260614000001`.

### Phase D.1 — Internal Learning Insights
Internal/admin page (`/ocr-learning`, hidden from nav, OWNER/ADMIN only) and API
(`GET /api/ocr-learning/summary`) showing correction patterns: bad merchants, bad
receipt types, weak fields, provider/strategy performance. **No parser rules are
auto-applied.** No migration.

> **TODO (pre-SaaS/public release):** the gate is `canViewOcrLearning`
> (OWNER/ADMIN). Re-confirm this is the right boundary — and consider a platform
> superadmin/dev-only gate — before any multi-tenant/public launch.

### Phase D.2 — Template Review Workflow
Internal/admin workflow turning insights into human-review template **drafts**:
each recommendation carries a risk level (amount-driven), per-field rates, a
reason, and a suggested next action; merchant recommendations generate a
read-only `TemplateDraft`. **Drafts are suggestions only** — no DB write, no
parser integration, validated to contain no raw OCR text, blocks, card/account
data, or receipt reference strings. No migration.

### Phase D.3A — Static Template Simulation (implemented)
Code-reviewed **static** templates (never DB-derived drafts) are run against the
parser result in **dry-run**: `simulateTemplates` reports what a template *would*
do (`no_match` / `same_as_parser` / `would_improve` / `would_conflict` /
`unsafe`) but changes nothing. It is wired into `runExtraction` as an internal,
best-effort, diagnostic field on the envelope — dropped from every response and
never persisted. An `OCR_TEMPLATE_MODE` flag (`off|simulate|apply`) gates whether
the dry-run runs; it defaults to `off` in production and `simulate` elsewhere, and
**`apply` is clamped to `off` in production and has no value-application code path
at all in D.3A.** Templates are code-reviewed only; generated drafts are never
used here.

### Phase D.3B — Guarded Static Template Application (implemented)
Code-reviewed static templates may now **influence** the user-facing extraction
result, but only under strict guards (`lib/ocr/templates/application.ts`):

- **Off by default.** Default behavior is unchanged unless `OCR_TEMPLATE_MODE=apply`.
- **Production needs a second guard.** In production, apply takes effect only with
  `OCR_TEMPLATE_APPLY_IN_PRODUCTION=true` as well; otherwise it is blocked (and the
  block reason is surfaced on `/ocr-learning`). Simulation may still run.
- **Fill, never override.** Amount is only filled when the parser amount is
  missing/weak (< 0.6) AND a preferred total-like label candidate is high-confidence
  (≥ 0.7). A `would_conflict`/`unsafe` decision (confident parser total) always
  keeps the parser amount. Date is only filled when the parser date is missing and a
  candidate is high-confidence. Invoice/reference is never forced.
- **Only reviewed static templates.** Generated DB drafts/recommendations and
  correction feedback remain advisory only — never imported by the live parser/
  application path (asserted by `tests/ocr-internal-guards.test.ts`).
- **Visible, not hidden.** Applied changes are recorded in internal `application`
  metadata on the envelope (dropped from user responses) and the
  `ReceiptExtractionAttempt` records the post-application values the user saw.

### Phase D.4 — More approved merchant templates (later)
Add further reviewed static merchant/receipt templates (beyond the generic cash
receipt), each justified by anonymized regression fixtures
(`tests/fixtures/receipts/*`) and the Phase C correction corpus, landing via code
review. DB feedback continues to *inform* which templates to author — it never
becomes a live rule automatically.

### Phase E — User-Facing Smart Receipt Experience (later)
Users see improved autofill, better confidence warnings, a simpler correction UI,
merchant memory, and fewer mistakes. Users never see OCR correction analytics
unless they are an admin/developer.

Stage A.2 added a 3-layer multi-engine pipeline (single/fallback/parallel),
candidate merging, and parser confidence/calibration fixes — see
[docs/ocr-multi-engine-strategy.md](./ocr-multi-engine-strategy.md).

## Does the app learn from corrections today?

**It now captures the signal, but it does not yet act on it.** Every expense
saved from a linked `ReceiptExtractionAttempt` writes a
`ReceiptCorrectionFeedback` row recording "OCR predicted X → user saved Y" per
field (invoice number, date, amount, plus the merchant guess and receipt type).
This is the **learning corpus foundation** — it is read-only data for offline
analysis. The parser (`lib/ocr/ocr-parsing.ts`) is still a fixed rule engine
that only changes when we change code; **no production rule ever mutates from
user input automatically.** Turning this corpus into improved extraction is
Phase D (vendor/receipt templates), which goes through code review and the
regression suite.

## Stage A — implemented now (no DB)

All changes are in the OCR library, the extract route, and the wizard. No schema,
no migrations, no persistence, no external AI.

1. **Blocks reach the parser.** `parseInvoiceFieldsFromText(rawText, provider,
   meanScore, blocks)` now accepts the engine's `OcrBlock[]`. PaddleOCR supplies
   geometry; Tesseract passes `[]` and degrades gracefully (text-only).
2. **Ranked candidates.** The result keeps the original five wizard fields and
   adds `candidates.{invoiceNumber,invoiceDate,amount}` — each candidate carries
   `value`, `confidence`, `sourceLabel`, `reason`, and best-effort `bbox/x/y`.
   The response shape is **additive**; existing consumers are unaffected.
3. **Receipt-type classification.** `receiptType` ∈ `retail | restaurant |
   bank_withdrawal | bank_deposit | transfer | informational | unknown`, from
   keyword/label signals.
4. **Multi-receipt detection.** Block geometry is clustered by x-position; a wide
   split between two populated columns sets `multipleReceipts`, lowers all field
   confidence (×0.5), and emits a warning. Needs Paddle blocks; Tesseract → off.
5. **Invoice/reference parsing.** Aliases: Invoice/Bill/Receipt/Transaction/
   Reference/Sequence/Order/Cheque/Sale No. Rejects account numbers, card numbers
   (Luhn), phone numbers, postal codes, tax IDs, loyalty points, store/terminal/
   register IDs. For bank receipts a labelled transaction/reference/sequence is a
   candidate **only when labelled**; an absent invoice number stays empty (never
   invented).
6. **Date parsing.** YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, unambiguous MM/DD/YYYY,
   "Fri Jun 20 2014", "Jun 20, 2014", "06/20/14", and date-with-time. Ambiguous
   day/month (both ≤ 12) gets lower confidence and an explicit candidate reason.
7. **Amount parsing.** Prioritizes Grand/Net Total, Amount/Total Paid, Total/
   Amount/Balance Due, and Withdraw/Withdrawal (bank withdrawal) / Deposit
   (dampened). Excludes change, subtotal-when-total-exists, tax-only, tips,
   loyalty points, balances, available balance, account/card numbers. **Never
   picks `0` unless an explicit total/paid label says so**, and never picks for
   `informational` receipts. Deposit/transfer/informational amounts are kept
   low-confidence for manual review. Date-line digits can't leak in as money.
8. **UI.** The review step shows parser warnings (multi-receipt, low-confidence,
   receipt-type), keeps the low-quality image warning from Phase 5.5, and adds a
   collapsible **OCR details** panel listing ranked candidates as tappable chips
   that fill the field. The extract route now always returns the extraction (200)
   so candidates/warnings reach the UI even when no field is confident.

**Safety stance:** a wrong amount is worse than a blank one. Low-confidence values
are never auto-saved; the save route still only applies an OCR value when its
confidence is > 0, and the parser refuses to emit confident-but-wrong amounts.

## Stage B — implemented (`ReceiptExtractionAttempt`)

Short-lived (60 min TTL), server-written, single-use, tenant-scoped row holding
redacted `rawText`/`blocks`, `candidates`, `confidence`, `receiptType`,
`imageQuality`, `provider`, `strategy`, `providersUsed`, `modelVersions`,
`parserVersion`, `fileSha256`, `expiresAt`. It is the trusted hand-off between
`/extract` and save, so persisted provenance is never browser-supplied. Consumed
atomically via a conditional `updateMany`; purged by
`npm run maintenance:extraction-attempts`. Card/account/phone digits are redacted
before storage.

## Stage C — implemented (`ReceiptCorrectionFeedback`)

On a successful save that consumed an attempt, the save route writes one durable
feedback row (best-effort — never blocks the save) recording predicted vs final
per field, plus the redacted merchant guess, receipt type, category, paid-by,
provider/strategy/`providersUsed`, and `parserVersion`. It stores **only derived
data** — no raw OCR text, no blocks, no file bytes; the candidate summary is
value-free (counts + top confidence/source). The source-attempt FK is
`SetNull`, so the short-lived attempt can be purged without deleting the durable
feedback. **Corrections are data, not live rules** — they feed offline analysis
and vendor-template authoring that go through code review and the regression
suite. No production rule ever mutates from user input automatically.

## Phase D.1 + D.2 — implemented (internal diagnostics)

The app now records learning signals (Phase C) **and surfaces them to owners/
admins**, but it still does **not** auto-learn production rules. The pieces are
inert and read-only:

1. **Insights** (`lib/ocr/learning-insights.ts`) — a pure `summarizeLearningInsights`
   over the feedback corpus (total records, amount/date/invoice correction rates,
   per-merchant and per-receipt-type stats, provider/strategy performance, and
   correct-vs-corrected examples). Empty-state safe. A single thin
   `getHouseholdLearningInsights(householdId)` wrapper is the **only** place
   household scoping is enforced, used by both the page and the API, with an
   explicit `select` allowlist of derived fields.
2. **Page + API (internal, OWNER/ADMIN only)** — `/ocr-learning` (server
   component, hidden from the primary nav, `notFound()` for non-admins) and
   `GET /api/ocr-learning/summary` (403 for non-admins), gated by
   `canViewOcrLearning`. They show **no raw OCR text, no blocks, no card/account
   numbers, and no invoice/reference strings** — only derived metrics,
   amounts/dates, and the already-redacted merchant guess.
3. **Template skeleton + recommendations** (`lib/ocr/templates/*`) — a code-only
   `MerchantTemplate` shape with one conservative example (generic cash receipt)
   and `buildTemplateRecommendations`, which emits human-readable suggestions
   (risk level, per-field rates, reason, suggested next action) gated by a minimum
   sample size. Nothing in `ocr-parsing.ts` / `ocr.service.ts` imports the
   templates — that import-absence (guarded by `tests/ocr-internal-guards.test.ts`)
   is the guarantee that feedback never changes parsing automatically.
4. **Template draft workflow (D.2)** — `generateTemplateDraft` turns a
   merchant recommendation into a read-only `TemplateDraft` (regex-escaped
   merchant + a HARDCODED label vocabulary + aggregate evidence; never receipt
   rows), and `validateTemplateDraft` rejects card/account-like values, long digit
   runs, and any `rawText`/`blocks` field while warning on risky preferred labels.
   Drafts are displayed read-only, written nowhere, and connected to nothing.
5. **Static template simulation (D.3A)** — `simulateTemplates` runs the
   code-reviewed static registry against a parser result in dry-run, returning a
   decision (`no_match`/`same_as_parser`/`would_improve`/`would_conflict`/
   `unsafe`) with safe reasons (template id, candidate source labels, amounts —
   never raw text or reference strings). It is wired into `runExtraction` as an
   internal envelope field (dropped from every response, never persisted), gated
   by `OCR_TEMPLATE_MODE` (default `off` in prod, `simulate` elsewhere). A small
   read-only "Template simulation status" card on `/ocr-learning` shows the current
   mode, the apply gate status, and the static templates.
6. **Guarded application (D.3B)** — `applyTemplate` turns a simulation into an
   actual change to the user-facing `response`, gated by `resolveApplicationGate`
   (`apply` mode + production second-guard `OCR_TEMPLATE_APPLY_IN_PRODUCTION=true`).
   It only FILLS a missing/weak amount from a high-confidence preferred total
   (never overrides `would_conflict`/`unsafe`), fills a missing date from a
   high-confidence candidate, and never forces an invoice. Off/simulate leave the
   result byte-identical (same object by reference). `parserResult` stays the raw
   pre-application result; the `ReceiptExtractionAttempt` records the post-application
   values the user saw, so Phase C feedback compares against the assisted prediction.

**Why human-reviewed templates are safer:** correction data is noisy and
adversarial-adjacent (a few odd receipts, or a user who edits for reasons
unrelated to OCR accuracy, would otherwise teach the parser the wrong rule).
A wrong amount is worse than a blank one, so a person vets every template before
it can affect what is auto-filled. The corpus *prioritizes* that human work; it
does not replace it.

## Phase D.4 + beyond (later)

- **D.4.** Add more reviewed static merchant/receipt templates beyond the generic
  cash receipt, each justified by anonymized regression fixtures
  (`tests/fixtures/receipts/*`) and the Phase C corpus, landing via code review.
  DB feedback remains advisory only.
- **E.** User-facing smart receipt experience (better autofill, confidence
  warnings, simpler correction UI, merchant memory). The regression dataset from
  anonymized receipts seeds this (Stage A already seeds it with
  `tests/ocr-stage-a.test.ts`).
- **F.** Optional ML/LLM extraction — only after a written privacy/security
  design. Not started.

## Privacy / security notes

- Receipts are PII-dense (names, card/account digits, balances). Stage A persists
  **nothing**. When Stage B/C land: redact card/account numbers before storage,
  short expiry on attempts, retention limits on raw text, encryption at rest,
  strict household scoping, single-use consumption.
- No receipt data is sent to any third-party service. No external LLM/AI is used.
- The "OCR details" panel surfaces candidate values to the uploader only; raw OCR
  text is intentionally not echoed to the client, and bytes/text are never logged.
