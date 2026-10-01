import type { ReceiptFixture } from "./types";

// Anonymized card payment slip. The masked card number must never become the
// amount or the reference; the printed Amount is the expense.
export const debitSlipFixture: ReceiptFixture = {
  name: "debit-slip",
  description: "Debit purchase slip with a masked card and an Amount line.",
  rawText: [
    "Example Store",
    "DEBIT PURCHASE",
    "Card ****1234",
    "Amount        25.00",
    "Approved",
    "Ref 000123",
    "2024-05-06",
  ].join("\n"),
  expect: {
    receiptType: ["retail", "unknown"],
    amount: 25.0,
    invoiceLikely: true,
    mustNotEqualAmount: [1234],
  },
  expectTemplate: { matches: false },
};
