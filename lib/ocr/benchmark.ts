import { toCents } from "@/lib/money";
import type { OcrResult } from "@/lib/ocr/types";

// OCR scorecard (upgrade-plan step 6a). Compares what OCR + the parser read
// with the answer a person typed, field by field, and totals the results.
// Shared by the generated-image benchmark and the saved-expense benchmark so
// both report the same numbers the same way.

export type BenchmarkField = "amount" | "date" | "vendor" | "tax";

export const BENCHMARK_FIELDS: BenchmarkField[] = ["amount", "date", "vendor", "tax"];

/** The correct values. A null field is not scored for that receipt. */
export type BenchmarkExpected = {
  amountCents: number;
  invoiceDate: string; // YYYY-MM-DD
  vendor: string | null;
  taxCents: number | null;
};

/**
 * "wrong": wrong and shown green, so a person may save it without looking.
 * "flagged": wrong but shown amber (confidence under GREEN_CONFIDENCE), so the
 * review step asks for a look. "skipped": no answer to compare with.
 * "unsupported": the parser does not read the field.
 */
export type FieldOutcome = "correct" | "wrong" | "flagged" | "missing" | "skipped" | "unsupported";

/** Same line as `isHigh` in components/expense-wizard.tsx: at or above it a field shows green. */
export const GREEN_CONFIDENCE = 0.7;

function wrongOutcome(confidence: number): FieldOutcome {
  return confidence >= GREEN_CONFIDENCE ? "wrong" : "flagged";
}

export type ReceiptScore = Record<BenchmarkField, FieldOutcome>;

export type FieldTotals = Record<FieldOutcome, number> & { scored: number; accuracy: number | null };

export type BenchmarkTotals = {
  receipts: number;
  failed: number;
  fields: Record<BenchmarkField, FieldTotals>;
};

/** Lowercase letters and digits only, so "WAL-MART #1234" and "Walmart" compare. */
export function normalizeVendor(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * A vendor read is correct when one normalized name contains the other and the
 * shorter has at least 4 characters. OCR often adds a store number or drops a
 * suffix ("COSTCO WHOLESALE #552" vs "Costco"); exact matching would score
 * every one of those wrong.
 */
export function vendorMatches(read: string, expected: string) {
  const a = normalizeVendor(read);
  const b = normalizeVendor(expected);
  if (!a || !b) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= 4 && longer.includes(shorter);
}

export function scoreReceipt(result: OcrResult, expected: BenchmarkExpected): ReceiptScore {
  const amount: FieldOutcome =
    result.amount > 0
      ? toCents(result.amount) === expected.amountCents
        ? "correct"
        : wrongOutcome(result.confidence.amount)
      : "missing";

  const date: FieldOutcome = result.invoiceDate
    ? result.invoiceDate === expected.invoiceDate
      ? "correct"
      : wrongOutcome(result.confidence.invoiceDate)
    : "missing";

  const vendor: FieldOutcome =
    expected.vendor === null || expected.vendor.trim() === ""
      ? "skipped"
      : result.merchant
        ? vendorMatches(result.merchant, expected.vendor)
          ? "correct"
          : "wrong"
        : "missing";

  const tax: FieldOutcome =
    expected.taxCents === null
      ? "skipped"
      : result.tax
        ? toCents(result.tax.value) === expected.taxCents
          ? "correct"
          : wrongOutcome(result.tax.confidence)
        : "missing";

  return { amount, date, vendor, tax };
}

function emptyFieldTotals(): FieldTotals {
  return { correct: 0, wrong: 0, flagged: 0, missing: 0, skipped: 0, unsupported: 0, scored: 0, accuracy: null };
}

/**
 * Accuracy is correct / scored, where scored excludes "skipped". A field the
 * parser does not read yet counts as scored and not correct, so it shows 0%.
 */
export function totalScores(scores: ReceiptScore[], failed = 0): BenchmarkTotals {
  const fields = Object.fromEntries(
    BENCHMARK_FIELDS.map((field) => [field, emptyFieldTotals()]),
  ) as Record<BenchmarkField, FieldTotals>;

  for (const score of scores) {
    for (const field of BENCHMARK_FIELDS) {
      fields[field][score[field]] += 1;
    }
  }
  for (const field of BENCHMARK_FIELDS) {
    const totals = fields[field];
    totals.scored = totals.correct + totals.wrong + totals.flagged + totals.missing + totals.unsupported;
    totals.accuracy = totals.scored > 0 ? totals.correct / totals.scored : null;
  }

  return { receipts: scores.length + failed, failed, fields };
}

export function formatTotals(title: string, totals: BenchmarkTotals) {
  const percent = (value: number | null) =>
    value === null ? "   n/a" : `${(value * 100).toFixed(1).padStart(5)}%`;
  const lines = [
    title,
    `Receipts: ${totals.receipts}  (OCR failed on ${totals.failed})`,
    `field    accuracy  correct  wrong  flagged  missing  not-read  skipped`,
  ];
  for (const field of BENCHMARK_FIELDS) {
    const t = totals.fields[field];
    lines.push(
      `${field.padEnd(8)} ${percent(t.accuracy)}  ${String(t.correct).padStart(7)}  ` +
        `${String(t.wrong).padStart(5)}  ${String(t.flagged).padStart(7)}  ${String(t.missing).padStart(7)}  ` +
        `${String(t.unsupported).padStart(8)}  ${String(t.skipped).padStart(7)}`,
    );
  }
  lines.push("wrong = shown green, so it can be saved unchecked; flagged = wrong but shown amber");
  return lines.join("\n");
}
