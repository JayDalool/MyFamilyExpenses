import type { ReceiptFixture } from "./types";

// Anonymized ATM withdrawal with NO sequence/reference number — invoice should
// stay optional (and become a generated label downstream), never invented. The
// available balance and masked card digits must never be chosen as the amount.
export const bankNoRefFixture: ReceiptFixture = {
  name: "bank-no-ref",
  description: "ATM withdrawal with no reference number; invoice should stay optional.",
  rawText: [
    "EXAMPLE BANK",
    "ATM WITHDRAWAL",
    "Card: ****1234",
    "Date 2024/03/15 14:22",
    "Withdraw        40.00",
    "Available Balance  300.00",
  ].join("\n"),
  expect: {
    receiptType: ["bank_withdrawal"],
    amount: 40.0,
    invoiceLikely: false,
    mustNotEqualAmount: [300.0, 1234],
  },
  expectTemplate: {
    matches: true,
    templateId: "generic-bank-atm",
    appliesAmount: false,
  },
};
