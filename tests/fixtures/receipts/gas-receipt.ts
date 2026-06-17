import type { ReceiptFixture } from "./types";

// Anonymized fuel receipt. The amount is the fuel Total — not the litre count.
export const gasReceiptFixture: ReceiptFixture = {
  name: "gas-receipt",
  description: "Gas station receipt with Pump, Fuel, litres, and Total.",
  rawText: [
    "Example Gas Bar",
    "Pump 03",
    "Unleaded",
    "Litres 40.00",
    "Fuel          60.00",
    "Total         60.00",
    "2024-05-03",
  ].join("\n"),
  expect: {
    receiptType: ["retail", "unknown"],
    amount: 60.0,
    invoiceLikely: false,
    // The litre quantity (40.00) must never be selected as the amount.
    mustNotEqualAmount: [40.0],
  },
  // No gas-specific static template (parser already picks the fuel Total).
  expectTemplate: { matches: false },
};
