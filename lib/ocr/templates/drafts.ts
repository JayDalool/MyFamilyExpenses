import type { ReceiptType } from "@/lib/ocr/types";
import type { AmountRules, ConfidenceBoost, DateRules, InvoiceRules } from "./types";
import type { RiskLevel, TemplateRecommendation } from "./recommendations";

// Phase D.2 template DRAFT workflow. A draft is a human-review artifact only:
// - no database write, no parser integration, no live effect;
// - built ONLY from aggregate stats + the (already redacted) merchant name +
//   a HARDCODED label vocabulary — never from raw receipt rows, dates, or
//   reference strings;
// - validated before display as a second line of defense against leakage.

// Hardcoded, safe vocabularies. Nothing here is derived from receipt content.
const PREFER_AMOUNT_LABELS = ["total", "amount", "amount paid", "grand total"];
const AVOID_AMOUNT_LABELS = [
  "subtotal",
  "change",
  "change due",
  "tax",
  "tip",
  "balance",
  "available balance",
];
const PREFER_DATE_FORMATS = ["yyyy-mm-dd", "dd/mm/yyyy", "mm/dd/yyyy"];
const INVOICE_LABEL_ALIASES = ["receipt no", "ref no", "sale no"];

export type TemplateDraftEvidence = {
  scope: "merchant" | "receiptType";
  target: string;
  sampleSize: number;
  amountChangeRate: number;
  dateChangeRate: number;
  invoiceChangeRate: number;
  riskLevel: RiskLevel;
};

// A draft mirrors MerchantTemplate but keeps merchantPattern as a regex SOURCE
// string (serializable/copyable) and carries draft metadata + evidence.
export type TemplateDraft = {
  status: "draft";
  source: "learning-insights";
  id: string;
  merchantPattern: string;
  receiptType: ReceiptType | "any";
  amountRules: AmountRules;
  dateRules: DateRules;
  invoiceRules: InvoiceRules;
  negativePatterns: string[];
  confidenceBoosts: ConfidenceBoost[];
  notes: string;
  evidence: TemplateDraftEvidence;
};

export type DraftValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "merchant";

// Round rates so the serialized draft never contains an incidental long digit run
// (e.g. 0.6666666666666666) that the validator would flag.
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Generate a merchant template DRAFT from a recommendation. Only ADD_MERCHANT_TEMPLATE
 * (merchant-scoped) recommendations produce a draft; everything else returns null.
 * Pure — no DB, no parser, no receipt content beyond the redacted merchant name.
 */
export function generateTemplateDraft(
  rec: TemplateRecommendation,
): TemplateDraft | null {
  if (rec.kind !== "ADD_MERCHANT_TEMPLATE" || rec.scope !== "merchant") return null;
  const merchant = rec.target.trim();
  if (merchant === "") return null;

  return {
    status: "draft",
    source: "learning-insights",
    id: `draft-${slugify(merchant)}`,
    merchantPattern: escapeRegExp(merchant),
    receiptType: "any",
    amountRules: {
      preferLabels: [...PREFER_AMOUNT_LABELS],
      avoidLabels: [...AVOID_AMOUNT_LABELS],
    },
    dateRules: { preferFormats: [...PREFER_DATE_FORMATS] },
    invoiceRules: {
      optional: true,
      generateLabel: true,
      labelAliases: [...INVOICE_LABEL_ALIASES],
    },
    negativePatterns: [],
    confidenceBoosts: [],
    notes:
      `DRAFT from ${rec.sampleSize} receipts where the amount was corrected ` +
      `${Math.round(rec.rates.amount * 100)}% of the time. Risk: ${rec.riskLevel}. ` +
      `Review by hand before any parser change — not applied automatically.`,
    evidence: {
      scope: rec.scope,
      target: merchant,
      sampleSize: rec.sampleSize,
      amountChangeRate: round4(rec.rates.amount),
      dateChangeRate: round4(rec.rates.date),
      invoiceChangeRate: round4(rec.rates.invoice),
      riskLevel: rec.riskLevel,
    },
  };
}

const FORBIDDEN_KEYS = /"(rawText|blocks)"\s*:/i;
const CARD_LIKE = /\b(?:\d[ -]?){13,19}\b/;
const LONG_DIGITS = /\d{7,}/; // long account/reference-like runs
const RISKY_AMOUNT_LABELS = ["subtotal", "tax", "change"];

/**
 * Validate a draft before it is shown/copied. Pure. Errors block; warnings are
 * advisory. Scans the WHOLE serialized draft so leakage in notes/evidence/labels
 * is caught, not just merchantPattern.
 */
export function validateTemplateDraft(draft: unknown): DraftValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!draft || typeof draft !== "object") {
    return { valid: false, errors: ["Draft must be an object."], warnings };
  }

  const d = draft as Partial<TemplateDraft>;

  if (typeof d.merchantPattern !== "string" || d.merchantPattern.trim() === "") {
    errors.push("merchantPattern is required.");
  }
  if (typeof d.receiptType !== "string" || d.receiptType.trim() === "") {
    errors.push("receiptType is required.");
  }

  const json = JSON.stringify(draft);
  if (FORBIDDEN_KEYS.test(json)) {
    errors.push("Draft must not contain rawText or blocks fields.");
  }
  if (CARD_LIKE.test(json)) {
    errors.push("Draft contains a card-like number.");
  }
  if (LONG_DIGITS.test(json)) {
    errors.push("Draft contains a long digit sequence (account/reference-like).");
  }

  const preferLabels = (d.amountRules?.preferLabels ?? []).map((l) => l.toLowerCase());
  for (const risky of RISKY_AMOUNT_LABELS) {
    if (preferLabels.some((label) => label.includes(risky))) {
      warnings.push(`Risky amount label preferred: "${risky}" — wrong amount is worse than blank.`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
