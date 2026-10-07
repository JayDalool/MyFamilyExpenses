# Upgrade plan: daily-use app

Decided with Jay on 2026-09-30. This is a plan, not a description of current code.

## Goal

MyFamilyExpenses (MFE) becomes the receipt vault for families, companies, realtors
and licensed professionals:

- accurate OCR that captures receipts and recognizes vendors and expense types
- at year end, export every receipt with its data for the accountant
- exchange car and maintenance receipts with SamVision by file

## Where we are (2026-10-01)

Steps 1-3 are merged to `main`. Step 4 is open in a pull request, as is the first CI
workflow; this section describes what is merged, not what is in flight.

- `main` carries phase5, the backup work and company households.
- Lint, typecheck and the test suite pass locally. CI (`.github/workflows/ci.yml`) is a
  separate open pull request — until it merges, every check figure in this repo comes from
  someone running the commands by hand.
- `Expense` stores vendor, tax, currency, payment method, notes and a business flag.
  Money is integer cents, tax included (`docs/adr/0002-money-in-cents.md`). The
  deprecated `amount` Decimal is still written and must be dropped in a follow-up
  migration.
- Reports export CSV, XLSX and PDF (cap 5,000 rows) and carry the new fields. Step 5
  adds a streamed ZIP with every receipt file, the index and the PDF summary, no row cap
  (`docs/architecture.md` §8.1).
- Households have a `kind` (FAMILY / COMPANY) with Admin, Accountant and Employee roles
  (`docs/adr/0001-organizations-as-households.md`).
- Nightly database backup and the receipt-file backup scripts exist. The restore drill and
  the offsite setup are still open on Jay in `docs/jay/MY_ACTIONS.md`.

## Decisions

| Topic | Decision |
| --- | --- |
| Roles | Admin, Accountant, Employee. All employees are equal. Accountant is read and export only. |
| Expense data | Add vendor, tax, currency, payment method, notes, business flag. Money in cents, total includes tax (same as SamVision). |
| OCR default | Tesseract, single strategy. Paddle was too slow and inaccurate. Measure before changing again. |
| Vehicles and mileage | Stay in SamVision. MFE does not rebuild them. |
| SamVision link | File exchange in both directions. No live API for now. |

## Steps (one PR each)

1. **Merge.** `phase5-ocr-foundation` into `main`. Decide on the local compose edits.
2. **Backups.** Include the uploads volume. Run and document a restore drill.
3. **Organizations.** Organization, Admin / Accountant / Employee roles. Decide before
   step 4 because it changes the schema.
4. **Expense fields.** Migration adding the fields above. Backfill existing rows safely.
5. **Accountant year-end package.** ZIP with receipt files, an index CSV/XLSX and a PDF
   summary. Streamed, no row cap.
6. **OCR accuracy.** Benchmark Tesseract on `tests/fixtures/receipts`. Read vendor and
   tax. Image cleanup. Vendor-based category suggestion from correction feedback.
7. **Vehicle receipts and SamVision file exchange.** See below.

## SamVision file exchange

SamVision (`/srv/server/apps/samvisionai`) already owns `vehicle`, `odometer_reading`,
`trip` and `expense` (vendor, `amount_cents` tax included, `tax_amount_cents`,
`receipt_ref`, note). It has no expense API. Its `/api/v1` routes need a SamVision
login session.

Both directions use a versioned ZIP: `manifest.json`, `expenses.csv`, and the receipt
files.

- **MFE to SamVision.** Export car and maintenance receipts. Each row carries the MFE
  receipt id, which SamVision stores in `receipt_ref`.
- **SamVision to MFE.** Import a ZIP. Rows create expenses in a chosen category.
  Importing the same file twice must not duplicate rows (match on the source id).
- Both apps stay independent. Neither fails if the other is down.

### Needed now

The ZIP format and an MFE export and import. A vehicle label and odometer reading on car
receipts, as plain fields.

### Designed for later

A live API between the apps. Keep the manifest version field so the format can change.

### Explicitly deferred

Vehicle, trip and deduction logic in MFE. Automatic sync. Multi-currency conversion.

## Risks and warnings

- Receipts contain personal data. Before real customers: privacy policy, per-user data
  export and delete, encrypted backups.
- Companies and realtors have legal retention periods for receipts. Do not allow silent
  deletion by default.
- SamVision says its deduction figures are blocked until an accountant reviews them, and
  its multi-tenant future depends on an MLS licensing answer. Keep the link optional.
- OCR stays advisory. The user reviews every field before saving.

## Verification per step

`npm run lint && npm run typecheck && npm test` (needs `.env.test`, see `docs/testing.md`).
UI steps also get a real-browser check on desktop and phone width.
