import assert from "node:assert/strict";
import test from "node:test";
import { extractInvoiceData } from "../lib/ocr/ocr.service";

test("mock OCR service returns invoice fields", async () => {
  const result = await extractInvoiceData({
    fileName: "receipt.pdf",
  });

  assert.match(result.invoiceNumber, /^MOCK-/);
  assert.match(result.invoiceDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof result.amount, "number");
  assert.equal(result.provider, "mock-ocr");
});
