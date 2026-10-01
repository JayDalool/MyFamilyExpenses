import { createEmptyOcrResult } from "@/lib/ocr/ocr-parsing";
import type { OcrResult } from "@/lib/ocr/types";

// Legacy / simple parser strategy.
//
// A deliberately small, high-precision regex extractor that recognizes the most
// obvious receipt patterns ("Total 84.80", "Date: 01-01-2018", "Invoice No X").
// It is NOT meant to replace the layout-aware parser — it runs alongside it so
// the ensemble can corroborate. Because it only fires on explicit, unambiguous
// patterns, its candidates are trustworthy when present and absent otherwise.
//
// The candidates it produces are tagged source: "legacy" and merged with the
// engine parsers by the existing candidate merger.

const SOURCE = "legacy";

const AMOUNT_LABEL =
  /\b(grand\s+total|net\s+total|total\s+paid|amount\s+paid|amount\s+due|balance\s+due|total\s+due|total)\b/i;
const NEGATIVE_AMOUNT_LINE =
  /\b(sub-?total|tax|gst|hst|pst|qst|change|tip|cash\s+tendered|loyalty|points|available\s+balance|account)\b/i;
// A money value with explicit cents — keeps precision high (ignores bare ints).
const MONEY = /(?:\$|usd|cad)?\s*(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})\b/i;

const DATE_LABEL = /\b(?:date|dated|invoice\s+date|receipt\s+date|purchase\s+date)\b/i;
const INVOICE_LABEL =
  /\b(invoice|receipt|transaction|reference|ref|order|bill|cheque|check|sequence|seq)\s*(?:#|no\.?|number|num|id)?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9/-]{2,31})\b/i;

function titleCase(label: string): string {
  return label
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function parseMoney(intPart: string, cents: string): number {
  return Number(`${intPart.replace(/,/g, "")}.${cents}`);
}

// Minimal date normalizer for the obvious formats only.
function legacyNormalizeDate(raw: string): string | null {
  const iso = raw.match(/\b((?:19|20)\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) {
    return toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }
  const slash = raw.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.]((?:19|20)?\d{2})\b/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const year = Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]);
    if (a > 31 || b > 31) return null;
    if (a > 12 && b <= 12) return toIso(year, b, a); // DD/MM
    if (b > 12 && a <= 12) return toIso(year, a, b); // MM/DD
    if (a === b) return toIso(year, a, b); // not actually ambiguous
    return null; // genuinely ambiguous → leave to the layout parser
  }
  return null;
}

function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

export function legacyParse(rawText: string): OcrResult {
  const result = createEmptyOcrResult(SOURCE);
  const lines = rawText
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  // Amount: explicit total/paid label + money-with-cents on the same line.
  for (const line of lines) {
    const label = line.match(AMOUNT_LABEL);
    if (!label) continue;
    if (NEGATIVE_AMOUNT_LINE.test(line) && !/\b(total|amount\s+paid|amount\s+due|balance\s+due)\b/i.test(label[0])) {
      continue;
    }
    if (/\bsub-?total\b/i.test(line) || /\bchange\b/i.test(line)) continue;
    const money = line.match(MONEY);
    if (!money) continue;
    const value = parseMoney(money[1], money[2]);
    if (!Number.isFinite(value)) continue;
    result.candidates.amount.push({
      value,
      confidence: 0.8,
      sourceLabel: titleCase(label[1]),
      reason: "Legacy: explicit total with cents",
      source: SOURCE,
    });
  }

  // Date: labelled date line, obvious formats only.
  for (const line of lines) {
    if (!DATE_LABEL.test(line)) continue;
    const iso = legacyNormalizeDate(line);
    if (!iso) continue;
    result.candidates.invoiceDate.push({
      value: iso,
      confidence: 0.8,
      sourceLabel: "Date",
      reason: "Legacy: labelled date",
      source: SOURCE,
    });
  }

  // Invoice/reference: labelled only.
  for (const line of lines) {
    if (/\b(?:address|tel|phone|account|card)\b/i.test(line)) continue;
    const m = line.match(INVOICE_LABEL);
    if (!m?.[2]) continue;
    if (!/\d/.test(m[2])) continue;
    result.candidates.invoiceNumber.push({
      value: m[2],
      confidence: 0.75,
      sourceLabel: `${titleCase(m[1])} No`,
      reason: "Legacy: labelled invoice/reference",
      source: SOURCE,
    });
  }

  // Promote the top candidate of each field to the flat result fields.
  const bestAmount = result.candidates.amount
    .slice()
    .sort((a, b) => b.confidence - a.confidence)[0];
  const bestDate = result.candidates.invoiceDate[0];
  const bestInvoice = result.candidates.invoiceNumber[0];

  if (bestAmount) {
    result.amount = bestAmount.value;
    result.confidence.amount = bestAmount.confidence;
  }
  if (bestDate) {
    result.invoiceDate = bestDate.value;
    result.confidence.invoiceDate = bestDate.confidence;
  }
  if (bestInvoice) {
    result.invoiceNumber = bestInvoice.value;
    result.confidence.invoiceNumber = bestInvoice.confidence;
  }

  return result;
}
