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

// Generic bank/ATM withdrawal: the expense amount is the withdrawn sum, never a
// balance/available balance/cash-back/fee. References are frequently absent, so the
// invoice stays optional with a generated label. Type-gated to bank_withdrawal and
// keyword-gated (atm/withdrawal), so it does not false-match retail/restaurant
// receipts. Proven by tests/fixtures/receipts/bank-atm + bank-no-ref. Note: this
// reinforces the parser's existing behavior; application only ever FILLS a weak
// amount and never overrides the parser's confident withdrawal pick.
export const GENERIC_BANK_ATM_TEMPLATE: MerchantTemplate = {
  id: "generic-bank-atm",
  merchantPattern: /\b(atm|withdrawal|withdraw|cash advance)\b/i,
  receiptType: "bank_withdrawal",
  amountRules: {
    preferLabels: ["withdrawal", "withdraw", "amount dispensed", "amount", "total"],
    avoidLabels: [
      "balance",
      "available balance",
      "opening balance",
      "ledger balance",
      "cash back",
      "cashback",
      "fee",
      "surcharge",
    ],
  },
  dateRules: {
    preferFormats: ["yyyy-mm-dd", "dd/mm/yyyy", "mm/dd/yyyy"],
  },
  invoiceRules: {
    optional: true,
    generateLabel: true,
    labelAliases: ["sequence no", "reference no", "ref no", "trace no"],
  },
  negativePatterns: ["deposit", "tax invoice"],
  confidenceBoosts: [],
  notes:
    "Bank/ATM withdrawal. Amount is the withdrawn sum — never a balance, available " +
    "balance, cash back, or fee. Reference often absent; keep it optional with a " +
    "generated label. Never overrides a confident parser amount.",
};

// Registry of REVIEWED STATIC templates. Generic, conservative, and type/keyword
// gated. Broad "any retail/restaurant/gas total" templates are intentionally NOT
// here — the parser already prefers Total and avoids subtotal/tax/change/tip, so a
// catch-all template would add no lift and concentrate risk (see the Phase D.4
// TODO in docs/phase6-ocr-intelligence-plan.md).
export const MERCHANT_TEMPLATES: MerchantTemplate[] = [
  GENERIC_CASH_RECEIPT_TEMPLATE,
  GENERIC_BANK_ATM_TEMPLATE,
];
