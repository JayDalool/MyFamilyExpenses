export function formatCurrency(value: number | string) {
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
