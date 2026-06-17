import type { ReceiptFixture } from "./types";

// Anonymized restaurant receipt. The expense total is the final Total — never the
// Subtotal and never the Tip alone.
export const restaurantTipFixture: ReceiptFixture = {
  name: "restaurant-tip",
  description: "Restaurant receipt with Subtotal, Tip, and a final Total.",
  rawText: [
    "The Example Bistro",
    "Server: Pat",
    "Subtotal      40.00",
    "Tip           8.00",
    "Total         48.00",
    "Visa ****4321",
    "2024/05/02",
  ].join("\n"),
  expect: {
    receiptType: ["restaurant"],
    amount: 48.0,
    invoiceLikely: false,
    mustNotEqualAmount: [40.0, 8.0, 4321],
  },
  // No restaurant-specific static template (parser already picks the final Total).
  expectTemplate: { matches: false },
};
