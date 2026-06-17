import type { MerchantTemplate } from "./types";

// The registry of REVIEWED STATIC templates — the only templates the simulation
// engine (and, later in D.3B, the parser) may use. These are hand-authored and
// changed only through code review. Database-derived suggestions live separately
// in drafts.ts and recommendations.ts and are NEVER imported here or by the live
// parser. Risky merchant-specific rules are not added without fixtures that prove
// them.

// Generic cash receipt: these almost never carry a real invoice/reference number,
// so we keep the reference optional and rely on a generated label. The amount
// rules only encode universally-safe choices (prefer the total; never take change
// or subtotal). No merchant-specific magic.
export const GENERIC_CASH_RECEIPT_TEMPLATE: MerchantTemplate = {
  id: "generic-cash-receipt",
  merchantPattern: /\bcash\s*(receipt|sale|memo)\b/i,
  receiptType: "retail",
  amountRules: {
    // "cash" (tendered) is deliberately NOT preferred: it is the money handed over,
    // not the total, and D.3B can auto-fill amount — wrong amount is worse than
    // blank. Only unambiguous total-like labels are preferred.
    preferLabels: ["total", "amount due", "amount paid"],
    avoidLabels: [
      "subtotal",
      "tax",
      "change",
      "change due",
      "balance",
      "available balance",
      "tip",
      "cash back",
      "cashback",
    ],
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
