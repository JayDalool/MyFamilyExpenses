import type { ReceiptFixture } from "./types";

// Anonymized generic cash receipt. No real merchant, address, or card data.
export const cashReceiptFixture: ReceiptFixture = {
  name: "cash-receipt",
  description: "Generic cash receipt with a total, change, and no reference number.",
  rawText: [
    "CASH RECEIPT",
    "Corner Market",
    "123 Example Street",
    "Date: 2024-03-14",
    "Item A        4.50",
    "Item B        3.25",
    "Subtotal      7.75",
    "Tax           0.25",
    "Total         8.00",
    "Cash         10.00",
    "Change        2.00",
    "Thank you!",
  ].join("\n"),
  expect: {
    receiptType: ["retail", "unknown"],
    amount: 8.0,
    invoiceLikely: false,
    mustNotEqualAmount: [2.0, 7.75, 10.0],
  },
};
