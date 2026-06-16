import type { LearningInsights } from "@/lib/ocr/learning-insights";

// Template recommendation engine (Phase D.1). Turns aggregated correction
// feedback into human-readable SUGGESTIONS. It never edits parser rules, never
// writes templates, and only emits suggestions backed by fields we actually
// store. Every suggestion is for a person to review.

export type RecommendationKind =
  | "ADD_MERCHANT_TEMPLATE"
  | "REVIEW_AMOUNT_RULES"
  | "KEEP_INVOICE_OPTIONAL"
  | "NO_TEMPLATE_NEEDED";

export type RecommendationSeverity = "info" | "suggestion" | "warning";

export type TemplateRecommendation = {
  kind: RecommendationKind;
  scope: "merchant" | "receiptType";
  target: string;
  sampleSize: number;
  /** Short metric string for display, e.g. "amount changed 67%". */
  metric: string;
  message: string;
  severity: RecommendationSeverity;
};

// Thresholds. Per-merchant suggestions need enough samples to be meaningful;
// receipt-type suggestions need a few more (they aggregate many merchants).
export const MIN_MERCHANT_SAMPLES = 3;
export const MIN_TYPE_SAMPLES = 5;
export const HIGH_CORRECTION_RATE = 0.5; // ≥50% corrected → worth a human look
export const HIGH_SUCCESS_RATE = 0.9; // ≥90% left unchanged → OCR already good

const pct = (rate: number) => `${Math.round(rate * 100)}%`;

const BANK_TYPES = new Set([
  "bank_withdrawal",
  "bank_deposit",
  "transfer",
  "informational",
]);

/**
 * Build template recommendations from precomputed insights. Pure. Suggestions are
 * sorted with warnings first, then by sample size (more evidence = higher).
 */
export function buildTemplateRecommendations(
  insights: LearningInsights,
): TemplateRecommendation[] {
  const recs: TemplateRecommendation[] = [];

  // ── Per merchant ───────────────────────────────────────────────────────────
  for (const m of insights.merchants) {
    if (m.total < MIN_MERCHANT_SAMPLES) continue;

    if (m.amountChangeRate >= HIGH_CORRECTION_RATE) {
      recs.push({
        kind: "ADD_MERCHANT_TEMPLATE",
        scope: "merchant",
        target: m.merchant,
        sampleSize: m.total,
        metric: `amount changed ${pct(m.amountChangeRate)}`,
        message:
          `Receipts from "${m.merchant}" had the amount corrected ${pct(m.amountChangeRate)} ` +
          `of the time (${m.amountChanged}/${m.total}). Consider adding a reviewed merchant ` +
          `template to improve amount parsing.`,
        severity: "warning",
      });
    } else if (1 - m.amountChangeRate >= HIGH_SUCCESS_RATE) {
      recs.push({
        kind: "NO_TEMPLATE_NEEDED",
        scope: "merchant",
        target: m.merchant,
        sampleSize: m.total,
        metric: `amount correct ${pct(1 - m.amountChangeRate)}`,
        message:
          `Amounts from "${m.merchant}" were already correct ${pct(1 - m.amountChangeRate)} of ` +
          `the time (${m.total} receipts). A template is probably not needed.`,
        severity: "info",
      });
    }
  }

  // ── Per receipt type ────────────────────────────────────────────────────────
  for (const t of insights.receiptTypes) {
    if (t.total < MIN_TYPE_SAMPLES) continue;

    if (BANK_TYPES.has(t.receiptType) && t.invoiceChangeRate >= HIGH_CORRECTION_RATE) {
      recs.push({
        kind: "KEEP_INVOICE_OPTIONAL",
        scope: "receiptType",
        target: t.receiptType,
        sampleSize: t.total,
        metric: `invoice changed ${pct(t.invoiceChangeRate)}`,
        message:
          `${t.receiptType} receipts often have no usable invoice/reference number ` +
          `(changed ${pct(t.invoiceChangeRate)} of ${t.total}). Keep the invoice optional and ` +
          `rely on a generated label.`,
        severity: "suggestion",
      });
    }

    if (t.amountChangeRate >= HIGH_CORRECTION_RATE) {
      recs.push({
        kind: "REVIEW_AMOUNT_RULES",
        scope: "receiptType",
        target: t.receiptType,
        sampleSize: t.total,
        metric: `amount changed ${pct(t.amountChangeRate)}`,
        message:
          `${t.receiptType} receipts had the amount corrected ${pct(t.amountChangeRate)} of the ` +
          `time (${t.amountChanged}/${t.total}). Review the amount parsing rules for this type.`,
        severity: "warning",
      });
    } else if (1 - t.amountChangeRate >= HIGH_SUCCESS_RATE) {
      recs.push({
        kind: "NO_TEMPLATE_NEEDED",
        scope: "receiptType",
        target: t.receiptType,
        sampleSize: t.total,
        metric: `amount correct ${pct(1 - t.amountChangeRate)}`,
        message:
          `${t.receiptType} amounts were already correct ${pct(1 - t.amountChangeRate)} of the ` +
          `time (${t.total} receipts). No template change appears necessary.`,
        severity: "info",
      });
    }
  }

  const severityRank: Record<RecommendationSeverity, number> = {
    warning: 0,
    suggestion: 1,
    info: 2,
  };
  return recs.sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] || b.sampleSize - a.sampleSize,
  );
}
