import type { MerchantTemplate } from "./types";

// The registry of human-authored merchant/receipt templates. Tonight it holds a
// single, deliberately conservative example. Risky merchant-specific rules are
// NOT added here without real correction-feedback evidence and human review.

// Generic cash receipt: these almost never carry a real invoice/reference number,
// so we keep the reference optional and rely on a generated label. The amount
// rules only encode universally-safe choices (prefer the total; never take change
// or subtotal). No merchant-specific magic.
export const GENERIC_CASH_RECEIPT_TEMPLATE: MerchantTemplate = {
  id: "generic-cash-receipt",
  merchantPattern: /\bcash\s*(receipt|sale|memo)\b/i,
  receiptType: "retail",
  amountRules: {
    preferLabels: ["total", "amount", "amount paid", "cash"],
    avoidLabels: ["subtotal", "change", "change due", "tax", "tip", "balance"],
  },
  dateRules: {
    preferFormats: ["yyyy-mm-dd", "dd/mm/yyyy", "mm/dd/yyyy"],
  },
  invoiceRules: {
    optional: true,
    generateLabel: true,
    labelAliases: ["receipt no", "sale no", "ref no"],
  },
  negativePatterns: ["invoice", "tax invoice"],
  confidenceBoosts: [],
  notes:
    "Conservative generic template. Cash receipts rarely have a real reference " +
    "number — keep it optional and use a generated label. Wrong amount is worse " +
    "than blank, so only well-known total labels are preferred.",
};

export const MERCHANT_TEMPLATES: MerchantTemplate[] = [GENERIC_CASH_RECEIPT_TEMPLATE];
