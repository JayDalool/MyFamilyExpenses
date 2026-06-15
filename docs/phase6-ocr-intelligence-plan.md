# Phase 6 — OCR Intelligence Plan

Status: **Stage A + A.2 implemented (library only). Stage B (extraction
attempts) and Stage C (correction feedback) implemented and persisted.** Stages
D–F are designed but not built.

- **Phase B = `ReceiptExtractionAttempt`** — short-lived, single-use,
  tenant-scoped server-side snapshot of what OCR/the parser saw, captured before
  the user edits anything. Migration `20260611000001`.
- **Phase C = `ReceiptCorrectionFeedback`** — durable, tenant-scoped record
  comparing OCR predictions against the values the user actually saved. Migration
  `20260614000001`.

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

## Stages D–F (later)

- **D.** Vendor/receipt templates (Starbucks, Walmart, gas, restaurant, bank/ATM),
  authored from the Stage C correction corpus. Can start rule-based; becomes
  data-driven once Stage C has a corpus.
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
