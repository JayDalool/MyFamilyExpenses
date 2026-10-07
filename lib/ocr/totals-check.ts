// Receipt arithmetic checks (upgrade-plan step 6b). A total is only trusted
// without a second look when the receipt's own numbers back it:
//
//   subtotal + taxes (+ tip) = total      "subtotal + tax"
//   items + taxes (+ tip)    = total      "items + tax"   (bills often have no subtotal)
//   a card line equals a total line       "card payment"
//   cash tendered - change   = total      "cash - change"   (exact cash: "cash payment")
//
// The field is "total paid, tip included", so when a checked total plus the
// tip is also printed (Total 31.50, Tip 5.00, Amount Paid 36.50) the larger
// figure wins. The same pass reads the tax lines (GST/PST/HST/QST/RST).
//
// Works in integer cents. Reads lines in order and pairs a label-only line with
// a money-only line right after it, because PP-OCR returns "TOTAL" and "85.90"
// as separate boxes.

export type ReceiptTotals = {
  // The total the arithmetic proves, or null when no check passed.
  verifiedTotalCents: number | null;
  // Which checks passed for that total, e.g. ["subtotal + tax", "card payment"].
  totalChecks: string[];
  // Sum of the tax lines, or null when none were read or they are implausible.
  taxCents: number | null;
  // True when the tax lines are part of a passing sum check.
  taxVerified: boolean;
  tipCents: number | null;
};

type Kind =
  | "subtotal"
  | "taxTotal"
  | "tax"
  | "tip"
  | "paid"
  | "total"
  | "change"
  | "cash"
  | "card";

type Row = { kind: Kind | null; cents: number; included: boolean; index: number };

// Money needs exactly two decimals, so "Table 7", "5%", "38.214 L" and the
// "05.05" in "05.05.2026" are not money.
const MONEY_PATTERN = /(?<![\d.,])-?\$?\s?(\d{1,3}(?:,\d{3})+\.\d{2}|\d{1,6}[.,]\d{2})(?![\d%]|[.,]\d)/g;

// Lines that never take part in the arithmetic: bill history, loyalty lines,
// suggested-tip tables, and GST/HST registration numbers (which would otherwise
// read as a tax label and borrow the next line's amount).
const SKIP_PATTERN =
  /\b(?:previous\s+balance|balance\s+forward|payments?\s+received|last\s+payment|you\s+saved|savings|points|rewards|cash\s*back|suggest(?:ed|ion)?|tip\s+guide)\b|\bRT\s?\d{4}\b|\b(?:gst|hst|qst|tps|tvq|tvh)(?:\s*\/\s*hst)?\s*(?:#|no\b|number|reg)/i;

// First match wins, so the specific labels come before the generic ones.
const KIND_PATTERNS: [Kind, RegExp][] = [
  ["subtotal", /\bsub[\s-]?total\b/i],
  ["taxTotal", /\b(?:total\s+tax(?:es)?|tax\s+total|taxes)\b/i],
  ["tax", /\b(?:gst|pst|hst|qst|rst|tps|tvq|tvh|tax)\b/i],
  ["tip", /\b(?:tip|gratuity|pourboire)\b/i],
  ["paid", /\b(?:amount|total)\s+paid\b/i],
  ["total", /\b(?:grand\s+|net\s+)?total\b|\b(?:amount|balance|total)\s+due\b/i],
  ["change", /\bchange\b/i],
  ["cash", /\bcash\b/i],
  ["card", /\b(?:visa|master\s?card|debit|credit|amex|american\s+express|interac|tap|flash|discover)\b/i],
];

const INCLUDED_PATTERN = /\bincl(?:\.|uded|udes|uding)?\b/i;

// The highest Canadian combined sales tax is 15% (HST); GST + QST is 14.975%.
// A little headroom covers per-line rounding.
const MAX_TAX_RATE = 0.155;

// One cent either way, for receipts that round each tax line separately.
const TOLERANCE_CENTS = 1;

function toCents(raw: string) {
  const normalized = raw.includes(",") && !raw.includes(".") ? raw.replace(",", ".") : raw.replace(/,/g, "");
  return Math.round(Number(normalized) * 100);
}

function moneyIn(line: string) {
  return [...line.matchAll(MONEY_PATTERN)].map((match) => {
    const cents = toCents(match[1]);
    return match[0].trimStart().startsWith("-") ? -cents : cents;
  });
}

function labelOf(line: string) {
  return line.replace(MONEY_PATTERN, " ");
}

function isMoneyOnly(line: string) {
  return moneyIn(line).length > 0 && labelOf(line).replace(/[\s$*:.\-]|CAD|C\$/gi, "") === "";
}

function kindOf(label: string): Kind | null {
  for (const [kind, pattern] of KIND_PATTERNS) {
    if (pattern.test(label)) return kind;
  }
  return null;
}

function readRows(lines: string[]): Row[] {
  const rows: Row[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (SKIP_PATTERN.test(line)) continue;
    const label = labelOf(line);
    const kind = kindOf(label);
    let money = moneyIn(line);
    // A label with no money of its own takes the next line when that line is
    // only an amount (PP-OCR splits "TOTAL" and "85.90" into two boxes).
    if (kind && money.length === 0 && index + 1 < lines.length && isMoneyOnly(lines[index + 1])) {
      money = moneyIn(lines[index + 1]);
      index += 1;
    }
    if (money.length === 0) continue;
    rows.push({ kind, cents: money[money.length - 1], included: INCLUDED_PATTERN.test(label), index });
  }
  return rows;
}

function near(a: number, b: number) {
  return Math.abs(a - b) <= TOLERANCE_CENTS;
}

export function checkReceiptTotals(lines: string[]): ReceiptTotals {
  const rows = readRows(lines);
  const of = (kind: Kind) => rows.filter((row) => row.kind === kind);

  const subtotals = of("subtotal").map((row) => row.cents);
  const taxRows = of("tax").length > 0 ? of("tax") : of("taxTotal");
  const addedTax = taxRows.filter((row) => !row.included).reduce((sum, row) => sum + row.cents, 0);
  const includedTax = taxRows.filter((row) => row.included).reduce((sum, row) => sum + row.cents, 0);
  // More than one distinct tip amount is a tip table, not a tip that was paid.
  const tips = [...new Set(of("tip").map((row) => row.cents).filter((cents) => cents > 0))];
  const tip = tips.length === 1 ? tips[0] : 0;
  const cash = of("cash").map((row) => row.cents);
  const change = of("change").map((row) => row.cents);
  const cards = of("card").map((row) => row.cents);
  const totalRows = rows.filter((row) => row.kind === "total" || row.kind === "paid");

  // Items: unlabelled amounts above the first subtotal/tax/total line.
  const firstAnchor = rows.findIndex((row) => row.kind !== null);
  const items = (firstAnchor === -1 ? rows : rows.slice(0, firstAnchor))
    .filter((row) => row.kind === null)
    .map((row) => row.cents);
  const itemSum = items.reduce((sum, cents) => sum + cents, 0);

  const checksFor = (total: number) => {
    const passed: string[] = [];
    const sums = [addedTax, addedTax + includedTax];
    if (subtotals.some((sub) => sums.some((tax) => near(sub + tax, total) || (tip > 0 && near(sub + tax + tip, total))))) {
      passed.push("subtotal + tax");
    }
    if (items.length >= 2 && sums.some((tax) => near(itemSum + tax, total) || (tip > 0 && near(itemSum + tax + tip, total)))) {
      passed.push("items + tax");
    }
    if (cards.includes(total) && totalRows.some((row) => row.cents === total)) {
      passed.push("card payment");
    }
    if (cash.some((given) => change.some((back) => near(given - back, total)))) {
      passed.push("cash - change");
    } else if (change.length === 0 && cash.includes(total) && totalRows.some((row) => row.cents === total)) {
      passed.push("cash payment");
    }
    return passed;
  };

  const candidates = [...new Set([...totalRows.map((row) => row.cents), ...cards])].filter((cents) => cents > 0);
  const verified = new Map<number, string[]>();
  for (const cents of candidates) {
    const passed = checksFor(cents);
    if (passed.length > 0) verified.set(cents, passed);
  }
  // Total paid includes the tip: Total 31.50 + Tip 5.00 = Amount Paid 36.50.
  if (tip > 0) {
    for (const [cents, passed] of [...verified]) {
      if (candidates.includes(cents + tip)) {
        verified.set(cents + tip, [...new Set([...(verified.get(cents + tip) ?? []), ...passed, "total + tip"])]);
      }
    }
  }

  const paidValues = new Set(of("paid").map((row) => row.cents));
  const lastIndexOf = (cents: number) => Math.max(...rows.filter((row) => row.cents === cents).map((row) => row.index));
  const ranked = [...verified.entries()].sort(
    ([a, aChecks], [b, bChecks]) =>
      Number(paidValues.has(b) || bChecks.includes("total + tip")) -
        Number(paidValues.has(a) || aChecks.includes("total + tip")) ||
      bChecks.length - aChecks.length ||
      lastIndexOf(b) - lastIndexOf(a),
  );
  const [verifiedTotalCents, totalChecks] = ranked[0] ?? [null, []];

  const taxSum = addedTax + includedTax;
  const totalForRate = verifiedTotalCents ?? (totalRows.length > 0 ? totalRows[totalRows.length - 1].cents : null);
  const plausible =
    taxRows.length > 0 &&
    taxSum >= 0 &&
    (totalForRate === null || taxSum <= MAX_TAX_RATE * Math.max(totalForRate - taxSum, 0));
  const taxVerified =
    plausible &&
    addedTax > 0 &&
    totalChecks.some((check) => check === "subtotal + tax" || check === "items + tax");

  return {
    verifiedTotalCents,
    totalChecks,
    taxCents: plausible ? taxSum : null,
    taxVerified,
    tipCents: tip > 0 ? tip : null,
  };
}
