import { toCents, centsToDecimalString } from "../../lib/money";

// Expense rows carry money twice while the cents migration is in its expand
// phase: `amountCents` is what the app reads, and the deprecated `amount`
// Decimal is dual-written so a rollback can still read rows written after the
// release. Fixtures spread this instead of setting either one by hand, so the
// two can never drift apart in a test.
export function money(amount: number) {
  const amountCents = toCents(amount);
  return { amountCents, amount: centsToDecimalString(amountCents) };
}
