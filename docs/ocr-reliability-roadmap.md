# OCR Reliability Roadmap

A practical, phased plan for improving receipt OCR accuracy and safety. Each
phase is shippable on its own. Guiding principles throughout:

- **Never fabricate financial values.** A blank amount is better than a wrong one.
- **Privacy first.** No raw receipt images or raw OCR text containing
  personal/card/account data in commits or third-party requests.
- **Fail closed.** Misconfiguration or engine failure surfaces a controlled error
  and manual entry, never fabricated data.

## Phase 1 — Instrumentation + safe strategy defaults ✅ (done)

- Per-engine diagnostics on every extraction (`provider`, `status`
  success/timeout/error/skipped, `durationMs`, `errorCode`/`safeReason`) with no
  raw OCR text/blocks. Total-vs-selected-provider timing tracked separately.
- Production strategy hardened to `OCR_PROVIDER=tesseract` + `OCR_STRATEGY=single`
  until Paddle is validated; sequential `ensemble`/`parallel` documented as unsafe
  production defaults (a slow Paddle is paid before Tesseract runs).
- See [ocr-multi-engine-strategy.md](./ocr-multi-engine-strategy.md).

## Phase 2 — Amount ranking guards + generated invoice fallback ✅ (done)

- **Amount guards.** Fee/tax/subtotal/change/cash-back/balance/tendered/tip lines
  are never selected as the payable total. A misleading `Fee total $0.00` line can
  no longer win over the real `Total $144.48`, and a `$0.00` is never chosen when
  any plausible non-zero total/payment exists. Final payable labels
  (`Total`, `Grand Total`, `Amount Due`, `Total Due`, `Amount Paid`, `Sale`) are
  preferred; card-payment lines (`Credit Card`/`Debit`/`Visa`/…) only confirm.
- **Ticket detection.** `Ticket: <number>` is now read as an invoice/reference.
- **Generated invoice fallback.** When no invoice/ticket/reference is detected and
  none is typed, the save flow assigns a household-scoped internal reference
  (`AUTO-000001`, `AUTO-000002`, …). It is minted under a per-household Postgres
  advisory lock so concurrent saves never collide (no schema change). User-typed
  and confidently OCR-detected numbers are always preserved. The UI labels these
  as internal references, never as vendor invoice numbers.
- **Regression fixture.** An anonymized `fee-total-zero` fixture (synthetic
  merchant/ticket, same label structure as the production "Danali" miss) locks in
  the amount/date/ticket behavior.

### Date note (investigated in Phase 2)

A receipt showing `19/06/2026` was stored as `2026-06-18`. The parser is **not**
at fault: `19/06/2026` has day > 12, so it is unambiguously parsed day-first to
`2026-06-19` (covered by a regression test), and the save path stores
`YYYY-MM-DDT00:00:00.000Z` into a `@db.Date` column without shifting. The
off-by-one is therefore either an **OCR digit misread** (`19`→`18`) or a
**display-time timezone artifact** when a `@db.Date` is rendered in a zone behind
UTC — not a parser ambiguity. No broad date changes were made; revisit only if a
test reproduces a genuine parser/storage shift.

## Phase 3 — Image quality & preprocessing (planned)

- Capture and persist image quality metrics (already partially available via
  `image-quality.ts`) to correlate low resolution with poor extractions.
- Preprocess before OCR: auto-crop to the receipt, deskew, and normalize
  contrast/threshold. This is the highest-leverage accuracy win for phone photos.
- Client-side warning for low-resolution/blurry captures *before* upload, guiding
  the user to retake rather than silently degrading extraction.

## Phase 4 — Paid-provider benchmark harness (planned)

- Build an offline benchmark that runs the **anonymized fixture corpus only**
  through local OCR vs. paid providers (Veryfi, Google Document AI, AWS Textract,
  Azure Document Intelligence).
- Score amount/date/invoice accuracy and latency; produce a comparison report.
- **No production receipts are ever uploaded to third parties.** Only the
  synthetic/anonymized fixtures may leave the machine, and only during an explicit
  benchmark run.

## Phase 5 — Optional paid provider behind a feature flag (planned)

- Only if Phase 4 proves a paid provider is materially more accurate: integrate it
  as an additional engine behind a feature flag, defaulting off.
- Credentials via server-side secrets only; per-request cost/latency budget and
  the Phase 1 diagnostics/fail-closed behavior apply. Local Tesseract remains the
  safe default fallback.
