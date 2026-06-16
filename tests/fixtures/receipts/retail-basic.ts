import type { ReceiptFixture } from "./types";

// Anonymized basic retail receipt with an invoice number and a card footer.
export const retailBasicFixture: ReceiptFixture = {
  name: "retail-basic",
  description: "Retail receipt with a labelled invoice number, date, and total.",
  rawText: [
    "Example Retail Co",
    "Invoice No: INV-2024-0042",
    "Date: 14/03/2024",
    "Widget          12.99",
    "Gadget           7.01",
    "Total           20.00",
    "VISA ****5678",
  ].join("\n"),
  expect: {
    receiptType: ["retail", "unknown"],
    amount: 20.0,
    invoiceLikely: true,
    // The card digits must never become the amount.
    mustNotEqualAmount: [5678],
  },
};
