import type { ReceiptFixture } from "./types";

// Anonymized debit purchase with cash back. The expense is the purchase Total —
// the Cash Back amount must never be selected as the expense.
export const cashBackFixture: ReceiptFixture = {
  name: "cash-back",
  description: "Debit purchase with a Cash Back line; expense is the Total only.",
  rawText: [
    "Example Mart",
    "Groceries",
    "Subtotal      30.00",
    "Total         30.00",
    "Cash Back     20.00",
    "Debit ****8899",
    "2024-05-05",
  ].join("\n"),
  expect: {
    receiptType: ["retail", "unknown"],
    amount: 30.0,
    invoiceLikely: false,
    // Cash back (20.00), subtotal (30 is also total here), and card digits excluded.
    mustNotEqualAmount: [20.0, 8899],
  },
  // "Cash Back" must NOT trigger the cash-receipt template.
  expectTemplate: { matches: false },
};
