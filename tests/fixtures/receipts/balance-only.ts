import type { ReceiptFixture } from "./types";

// Anonymized informational bank slip with only balances and no purchase total.
// No amount should be selected — a blank amount is correct (and safer than a
// balance masquerading as an expense).
export const balanceOnlyFixture: ReceiptFixture = {
  name: "balance-only",
  description: "Informational slip showing Balance / Available Balance, no purchase total.",
  rawText: [
    "Example Bank",
    "Account Statement",
    "Balance        540.00",
    "Available Balance 540.00",
    "Date 2024/05/04",
  ].join("\n"),
  expect: {
    receiptType: ["informational", "unknown"],
    // No confident amount expected — must stay blank (0).
    amount: undefined,
    invoiceLikely: false,
    mustNotEqualAmount: [540.0],
  },
  expectTemplate: { matches: false },
};
