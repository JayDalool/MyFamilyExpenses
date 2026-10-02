// Money is stored as integer cents, tax included, matching SamVision's
// `amount_cents`. Every conversion between cents and the decimal amounts people
// type or read lives here, so there is exactly one rounding rule in the app.
// See docs/adr/0002-money-in-cents.md.

// Largest value the Int column holds: ~21.47 million dollars. Validation rejects
// anything above this rather than letting Postgres raise.
export const MAX_AMOUNT_CENTS = 2_147_483_647;

export function toCents(amount: number): number {
  if (!Number.isFinite(amount)) {
    throw new RangeError("Amount must be a finite number.");
  }

  // Scaling a binary float loses cents: 1.005 * 100 is 100.49999999999999 and
  // 8.165 * 100 is 816.4999999999999, so rounding those directly drops a cent
  // the user did type. toFixed(2) re-rounds the scaled value at a precision far
  // below a cent, which absorbs the representation error before the decision.
  const scaled = Number((amount * 100).toFixed(2));

  // Then round half AWAY FROM ZERO. Math.round alone rounds .5 towards
  // +Infinity, which turns -0.005 into -0 and hides the sign.
  const cents = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);

  if (!Number.isSafeInteger(cents)) {
    throw new RangeError("Amount is too large to store.");
  }

  return cents;
}

export function fromCents(cents: number): number {
  return cents / 100;
}

// For the deprecated `amount` Decimal column, which is still written so a
// rollback can read it. Prisma accepts a string for a Decimal field, and a
// string avoids reintroducing a float at the write boundary.
export function centsToDecimalString(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

export function formatCents(cents: number, currency = "CAD"): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: currency.trim() || "CAD",
  }).format(fromCents(cents));
}
