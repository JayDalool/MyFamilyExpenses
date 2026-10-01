# 0002. Money is integer cents, tax included

Date: 2026-10-01. Status: accepted (Jay).

## Context

Step 4 of `docs/upgrade-plan.md` adds vendor, tax, currency, payment method, notes and a
business flag to `Expense`, and the plan records the decision "money in cents, total
includes tax (same as SamVision)".

Before this change `expenses.amount` was `Decimal(12, 2)` and there was no tax column.
SamVision (`/srv/server/apps/samvisionai`) stores `amount_cents` with tax included plus a
separate `tax_amount_cents`. Step 7 exchanges receipts with it by file, so a mismatch in
representation would mean converting on every exchange, in both directions, forever.

Thirty files read or wrote `amount`, twenty-two of them converting a Prisma `Decimal`.

## Decision

- Money is stored as **integer cents** in `amount_cents`. `amount_cents` is the total
  actually paid, **tax included**.
- `tax_cents` holds the tax portion *of* that total and is nullable. Most receipts do not
  state tax, and it is never inferred — the pre-tax figure is a subtraction, not a rate.
- `currency` is `CHAR(3)` defaulting to `CAD`. Multi-currency conversion stays deferred;
  the column exists so a future rate table has something to key on.
- `payment_method` is a Prisma enum (`CASH`, `DEBIT`, `CREDIT`, `ETRANSFER`, `OTHER`),
  nullable, so reports can group by it. Adding a value later is an additive migration.
- `is_business` defaults to `false` in the database so a stored row means the same thing in
  every household. The expense form pre-ticks it when `householdKind` is `COMPANY`.
- `vendor` and `notes` are nullable text, capped at 120 and 500 characters in validation.
  `vendor` is indexed with `household_id` for the step-6 category suggestion.

### Expand then contract

The deprecated `amount` column is **kept and still written**, in step with
`amount_cents`, for one release. Nothing reads it. A follow-up migration drops it once Jay
has compared the two columns in production.

This is why a rollback is cheap: the previous code reads `amount`, and `amount` is correct
even for rows written after this release.

## Alternatives considered

- **Keep `Decimal(12, 2)` and add tax the same way.** By far the smallest change. Rejected:
  it diverges from the plan and from SamVision, so every file exchange converts and the two
  apps disagree about money permanently.
- **One cut: convert `amount` in place and drop it immediately.** Smaller final diff and
  nothing to clean up. Rejected: no safety net, and a rollback after any new row is written
  means rebuilding values from a backup.

## Consequences

- `lib/money.ts` is the only place that converts. `toCents` scales through `toFixed(2)`
  first, because `1.005 * 100` is `100.49999999999999` in IEEE 754 and rounding that
  directly drops a cent the user typed. It rounds half away from zero so a sign cannot be
  hidden. `tests/money.test.ts` pins both behaviours — the test caught the bug.
- **Units are now part of every name.** Reporting returns `totalCents` / `averageCents` /
  `amountCents`, and `lib/utils.ts` exports `formatDollars` while `lib/money.ts` exports
  `formatCents`. The old `formatCurrency(value: number | string)` accepted either unit
  silently and rendered cents 100x, which is exactly the bug this naming prevents. Do not
  reintroduce a money formatter that does not say its unit.
- `GET /api/reports/summary` now returns `totalCents` instead of `total`. The only consumer
  is this app. Renaming rather than changing the unit under the same name is deliberate.
- CSV and XLSX exports write decimal dollars (`fromCents`) because they land in a
  spreadsheet; the PDF formats cents for a human reader.
- Three CHECK constraints enforce what the type cannot: the total is non-negative, tax is
  non-negative, and tax never exceeds the total. The same tax rule is a Zod refinement, so
  a bad payload fails with a field message before it reaches Postgres.
- `amount_cents` is `INTEGER`, capping a single expense at $21,474,836.47. Validation
  rejects more with a message rather than letting Postgres raise.
- The OCR feedback tables (`ReceiptExtractionAttempt.predictedAmount`,
  `ReceiptCorrectionFeedback.finalAmount`) are still `Decimal` dollars. They are internal
  diagnostics, not money the app reports on. They move to cents in the same follow-up
  migration that drops `amount`, so the codebase does not keep two conventions for long.

## Future considerations

Dropping `amount`; converting the OCR feedback columns; a rate table if multi-currency is
ever wanted; and whether `escapeCell` in the CSV exporter should stop printing counts with
two decimal places (pre-existing, unrelated to money).
