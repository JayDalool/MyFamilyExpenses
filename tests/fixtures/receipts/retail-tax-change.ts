import type { ReceiptFixture } from "./types";

// Anonymized retail receipt where Subtotal, Tax, Cash, and Change are all present.
// The expense is the Total — never the subtotal, tax, cash tendered, or change.
export const retailTaxChangeFixture: ReceiptFixture = {
  name: "retail-tax-change",
  description: "Retail receipt with Subtotal, Tax, Total, Cash, and Change.",
  rawText: [
    "Example Shop",
    "Subtotal      18.00",
    "Tax            2.00",
    "Total         20.00",
    "Cash          25.00",
    "Change         5.00",
    "2024-05-07",
  ].join("\n"),
  expect: {
    receiptType: ["retail", "unknown"],
    amount: 20.0,
    invoiceLikely: false,
    mustNotEqualAmount: [18.0, 2.0, 25.0, 5.0],
  },
  expectTemplate: { matches: false },
};
