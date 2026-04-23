import assert from "node:assert/strict";
import test from "node:test";
import { OcrProviderError } from "../lib/ocr/ocr-errors";
import {
  hasAnyOcrField,
  parseInvoiceFieldsFromText,
} from "../lib/ocr/ocr-parsing";
import { extractInvoiceData } from "../lib/ocr/ocr.service";
import { MockOcrProvider } from "../lib/ocr/mock-ocr-provider";
import { TesseractOcrProvider } from "../lib/ocr/tesseract-ocr-provider";

test("mock OCR service returns invoice fields", async () => {
  const originalProvider = process.env.OCR_PROVIDER;
  process.env.OCR_PROVIDER = "mock";

  const result = await extractInvoiceData({
    fileName: "receipt.pdf",
  });

  assert.match(result.invoiceNumber, /^MOCK-/);
  assert.match(result.invoiceDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof result.amount, "number");
  assert.equal(result.provider, "mock");

  if (originalProvider === undefined) {
    delete process.env.OCR_PROVIDER;
  } else {
    process.env.OCR_PROVIDER = originalProvider;
  }
});

test("mock OCR provider exposes a clean provider contract", async () => {
  const provider = new MockOcrProvider();
  const result = await provider.extract({
    fileName: "receipt.pdf",
  });

  assert.equal(provider.name, "mock");
  assert.equal(result.provider, provider.name);
});

test("parser extracts invoice fields from receipt text", () => {
  const parsed = parseInvoiceFieldsFromText(
    `
      Invoice No: INV-1001
      Date: 2026-04-22
      Grand Total: $42.50
    `,
    "tesseract",
    92,
  );

  assert.equal(parsed.invoiceNumber, "INV-1001");
  assert.equal(parsed.invoiceDate, "2026-04-22");
  assert.equal(parsed.amount, 42.5);
  assert.equal(hasAnyOcrField(parsed), true);
});

test("parser returns partial values when only total is found", () => {
  const parsed = parseInvoiceFieldsFromText(
    "Thank you for your purchase\nTotal Due 18.99",
    "tesseract",
    65,
  );

  assert.equal(parsed.invoiceNumber, "");
  assert.equal(parsed.invoiceDate, "");
  assert.equal(parsed.amount, 18.99);
  assert.equal(parsed.confidence.amount > 0, true);
  assert.equal(parsed.confidence.invoiceNumber, 0);
});

test("tesseract provider rejects pdf files with a clear error", async () => {
  const provider = new TesseractOcrProvider();

  await assert.rejects(
    provider.extract({
      fileName: "receipt.pdf",
      mimeType: "application/pdf",
    }),
    (error: unknown) =>
      error instanceof OcrProviderError &&
      error.code === "PDF_NOT_SUPPORTED",
  );
});
