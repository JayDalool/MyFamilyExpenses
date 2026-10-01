import type { ReceiptFixture } from "./types";

// Anonymized regression for the "Danali" production miss: a receipt with a
// misleading "Fee total $0.00" line plus Subtotal / GST / PST / Total Tax, then
// the real "Total", "Credit Card", and "Sale" all at the payable amount. The
// parser previously matched "Fee total" as the generic Total label and could
// select $0.00. Merchant name, ticket number, and date are synthetic (no raw
// production receipt data); only the label STRUCTURE mirrors the real receipt.
// The ticket is a short alphanumeric value (not the real 12-digit number) so no
// long digit run is committed — see the fixture privacy guard in
// ocr-template-benchmark.test.ts.
export const feeTotalZeroFixture: ReceiptFixture = {
  name: "fee-total-zero",
  description:
    "Auto-shop receipt with a misleading 'Fee total $0.00' line and a real Total of 144.48.",
  rawText: [
    "Example Auto Shop",
    "Ticket: TK100234",
    "19/06/2026 2:32 pm",
    "Fee total $0.00",
    "Subtotal $129.00",
    "GST $6.45",
    "PST $9.03",
    "Total Tax $15.48",
    "Total $144.48",
    "Credit Card $144.48",
    "Sale $144.48",
  ].join("\n"),
  expect: {
    receiptType: ["retail", "unknown"],
    amount: 144.48,
    invoiceLikely: true,
    // The $0.00 fee and every non-payable subtotal/tax line must never be chosen.
    mustNotEqualAmount: [0, 129.0, 6.45, 9.03, 15.48],
  },
  expectTemplate: { matches: false },
};
