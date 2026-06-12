# Phase 6 — OCR Intelligence Plan

Status: **Stage A + A.2 implemented (no database, no persistence).** Stages B–F
are designed but not built. No migrations were added in this phase.

Stage A.2 added a 3-layer multi-engine pipeline (single/fallback/parallel),
candidate merging, and parser confidence/calibration fixes — see
[docs/ocr-multi-engine-strategy.md](./ocr-multi-engine-strategy.md).

## Does the app learn from corrections today?

**No.** `Expense` stores only the final `invoiceNumber` / `invoiceDate` /
`amount`; the OCR prediction is discarded the moment the user edits it. There is
no `ReceiptExtractionAttempt` / `ReceiptCorrection` table and the save route
never records "OCR predicted X → user corrected to Y". The parser
(`lib/ocr/ocr-parsing.ts`) is a fixed rule engine that only improves when we
change code. Capturing corrections as structured data is Stage B/C work and
requires migrations we will design and approve separately.

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

## Stage B — tomorrow (needs migration + approval)

`ReceiptExtractionAttempt`: short-lived, server-written, single-use, tenant-scoped
row holding `rawText`, `blocks`, `candidates`, `confidence`, `receiptType`,
`imageQuality`, `provider`, `modelVersion`, `parserVersion`, `fileSha256`,
`expiresAt`. It is the trusted hand-off between `/extract` and save, so persisted
provenance is never browser-supplied.

## Stage C — learning loop (later)

`ReceiptCorrection`: on save, link `Expense ↔ attempt` and record predicted vs
final per field, plus vendor guess, receipt type, category, paid-by, and
`parserVersion`. **Corrections are data, not live rules** — they feed offline
analysis and vendor-template authoring that go through code review and the
regression suite. No production rule ever mutates from user input automatically.

## Stages D–F (later)

- **D.** Vendor/receipt templates (Starbucks, Walmart, gas, restaurant, bank/ATM).
  Can start rule-based; becomes data-driven once Stage C has a corpus.
- **E.** Regression dataset from anonymized receipts (Stage A already seeds this
  with `tests/ocr-stage-a.test.ts`).
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
