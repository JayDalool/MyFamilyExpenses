import type { ReceiptType } from "@/lib/ocr/types";

// Code-only merchant/receipt template skeleton (Phase D.1). These describe how a
// known merchant's receipts *should* be parsed. They are INERT: nothing in the
// OCR pipeline imports or applies them yet. Templates are authored and changed by
// humans through code review — never generated or mutated from feedback data at
// runtime. The correction-feedback corpus only *informs* which templates a person
// might want to add (see buildTemplateRecommendations).

export type TemplateField = "amount" | "invoiceDate" | "invoiceNumber";

export type AmountRules = {
  /** Receipt labels whose value should be preferred as the amount (e.g. "Total"). */
  preferLabels?: string[];
  /** Labels whose value must never be taken as the amount (e.g. "Subtotal", "Change"). */
  avoidLabels?: string[];
};

export type DateRules = {
  /** Date formats this merchant tends to use, most-preferred first. */
  preferFormats?: string[];
};

export type InvoiceRules = {
  /** This merchant frequently has no invoice/reference number. */
  optional?: boolean;
  /** Safe to fall back to a generated merchant+date label when absent. */
  generateLabel?: boolean;
  /** Label aliases that indicate a real reference number for this merchant. */
  labelAliases?: string[];
};

export type ConfidenceBoost = {
  field: TemplateField;
  /** Additive boost in 0–1 space; kept small and conservative. */
  boost: number;
};

export type MerchantTemplate = {
  id: string;
  /** Case-insensitive match against the redacted merchant guess / receipt text. */
  merchantPattern: RegExp;
  /** The receipt type this template applies to ("any" = not type-restricted). */
  receiptType: ReceiptType | "any";
  amountRules: AmountRules;
  dateRules: DateRules;
  invoiceRules: InvoiceRules;
  /** Substrings that, if matched, indicate this template should NOT apply. */
  negativePatterns?: string[];
  confidenceBoosts?: ConfidenceBoost[];
  /**
   * Selection priority when multiple templates match: HIGHER wins (ties broken by
   * registry order). Generic templates use 0; future merchant-specific templates
   * use a higher number so they take precedence over the generic fallbacks.
   */
  priority?: number;
  notes?: string;
};
