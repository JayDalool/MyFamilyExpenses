import type { ReceiptFixture } from "./types";

// Anonymized ATM withdrawal slip. Card number is masked sample data only.
export const bankAtmFixture: ReceiptFixture = {
  name: "bank-atm",
  description: "ATM cash withdrawal with a labelled sequence number and masked card.",
  rawText: [
    "EXAMPLE BANK",
    "ATM WITHDRAWAL",
    "Card: ****1234",
    "Date 2024/03/15 14:22",
    "Sequence No 004615-312-001",
    "Withdraw        60.00",
    "Available Balance  540.00",
  ].join("\n"),
  expect: {
    receiptType: ["bank_withdrawal"],
    amount: 60.0,
    invoiceLikely: true,
    // The available balance and masked-card digits must never become the amount.
    mustNotEqualAmount: [540.0, 1234],
  },
};
