import assert from "node:assert/strict";
import test from "node:test";
import { extractInvoiceData } from "../lib/ocr/ocr.service";
import { MockOcrProvider } from "../lib/ocr/mock-ocr-provider";

test("mock OCR service returns invoice fields", async () => {
  const result = await extractInvoiceData({
    fileName: "receipt.pdf",
  });

  assert.match(result.invoiceNumber, /^MOCK-/);
  assert.match(result.invoiceDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof result.amount, "number");
  assert.equal(result.provider, "mock");
});

test("mock OCR provider exposes a clean provider contract", async () => {
  const provider = new MockOcrProvider();
  const result = await provider.extract({
    fileName: "receipt.pdf",
  });

  assert.equal(provider.name, "mock");
  assert.equal(result.provider, provider.name);
});
