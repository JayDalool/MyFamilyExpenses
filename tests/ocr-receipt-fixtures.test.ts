import assert from "node:assert/strict";
import test from "node:test";
import { parseInvoiceFieldsFromText } from "../lib/ocr/ocr-parsing";
import { RECEIPT_FIXTURES } from "./fixtures/receipts";

// Regression baseline over the anonymized receipt fixtures. These assert the
// safety-critical behaviors: the right amount is chosen, change/balance/card
// digits are never picked as money, and receipt-type classification holds.

for (const fixture of RECEIPT_FIXTURES) {
  test(`fixture ${fixture.name}: parses safely and as expected`, () => {
    const result = parseInvoiceFieldsFromText(fixture.rawText, "paddle", 0.9);

    assert.ok(result.amount >= 0, "amount is never negative");
    assert.ok(
      fixture.expect.receiptType.includes(result.receiptType),
      `receiptType ${result.receiptType} not in expected ${fixture.expect.receiptType.join("/")}`,
    );

    if (fixture.expect.amount !== undefined && result.confidence.amount > 0) {
      assert.equal(result.amount, fixture.expect.amount);
    }

    for (const forbidden of fixture.expect.mustNotEqualAmount ?? []) {
      assert.notEqual(result.amount, forbidden, `amount must not equal ${forbidden}`);
    }

    if (fixture.expect.invoiceLikely) {
      assert.ok(
        result.invoiceNumber !== "" && result.confidence.invoiceNumber > 0,
        "expected a confident invoice/reference number",
      );
    } else {
      // No reference on the receipt → parser must not invent one.
      assert.ok(
        result.invoiceNumber === "" || result.confidence.invoiceNumber === 0,
        "no invoice number should be confidently emitted",
      );
    }
  });
}
