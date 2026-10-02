// Formats a value already expressed in DOLLARS. Anything stored in cents goes
// through formatCents in lib/money.ts instead — the old name took number|string
// and silently accepted cents, which renders 100x.
export function formatDollars(value: number | string) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(Number(value) || 0);
}

export function getStartOfToday() {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function getStartOfMonth() {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), 1);
}
