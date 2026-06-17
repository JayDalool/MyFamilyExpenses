import type { ReceiptFixture } from "./types";

// Anonymized retail receipt with NO invoice/reference number (common for small
// shops). The total must be picked; the masked card digits must not.
export const retailNoInvoiceFixture: ReceiptFixture = {
  name: "retail-no-invoice",
  description: "Retail receipt with a total but no invoice/reference number.",
  rawText: [
    "Example Retail Co",
    "Date: 2024-03-14",
    "Widget          12.99",
    "Gadget           7.01",
    "Total           20.00",
    "VISA ****5678",
  ].join("\n"),
  expect: {
    receiptType: ["retail", "unknown"],
    amount: 20.0,
    invoiceLikely: false,
    mustNotEqualAmount: [5678],
  },
  expectTemplate: { matches: false },
};
