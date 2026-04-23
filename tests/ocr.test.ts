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

test("parser prefers grand total over subtotal and tax lines", () => {
  const parsed = parseInvoiceFieldsFromText(
    `
      Subtotal 12.40
      Tax 1.60
      Grand Total 14.00
    `,
    "tesseract",
    88,
  );

  assert.equal(parsed.amount, 14);
});

test("parser prefers amount paid over tax-only lines", () => {
  const parsed = parseInvoiceFieldsFromText(
    `
      HST 1.82
      Amount Paid $15.82
      Change 0.00
    `,
    "tesseract",
    84,
  );

  assert.equal(parsed.amount, 15.82);
});

test("parser supports common receipt date formats", () => {
  const slashDate = parseInvoiceFieldsFromText(
    "Transaction Date 04/23/26 09:41",
    "tesseract",
    81,
  );
  const dayMonthDate = parseInvoiceFieldsFromText(
    "Receipt Date 23.04.2026",
    "tesseract",
    81,
  );

  assert.equal(slashDate.invoiceDate, "2026-04-23");
  assert.equal(dayMonthDate.invoiceDate, "2026-04-23");
});

test("parser detects transaction numbers and ignores store and phone numbers", () => {
  const parsed = parseInvoiceFieldsFromText(
    `
      Store No: 104
      Phone: 204-555-1212
      Trans No: 874411
      Amount Paid: 21.55
    `,
    "tesseract",
    86,
  );

  assert.equal(parsed.invoiceNumber, "874411");
});

test("parser detects check and order number labels", () => {
  const checkParsed = parseInvoiceFieldsFromText(
    "Check No: 009812\nTotal 42.50",
    "tesseract",
    86,
  );
  const orderParsed = parseInvoiceFieldsFromText(
    "Order No. A-44591\nTotal 19.99",
    "tesseract",
    86,
  );

  assert.equal(checkParsed.invoiceNumber, "009812");
  assert.equal(orderParsed.invoiceNumber, "A-44591");
});

test("parser handles Canadian grocery receipt patterns", () => {
  const parsed = parseInvoiceFieldsFromText(
    `
      WALMART CANADA
      Date 23/04/2026 14:53
      Receipt # 004615-312-001
      Subtotal 45.12
      HST 5.87
      Total 50.99
      Interac 50.99
    `,
    "tesseract",
    89,
  );

  assert.equal(parsed.invoiceDate, "2026-04-23");
  assert.equal(parsed.invoiceNumber, "004615-312-001");
  assert.equal(parsed.amount, 50.99);
});

test("parser handles Canadian restaurant receipt patterns", () => {
  const parsed = parseInvoiceFieldsFromText(
    `
      THE KEG
      Transaction Date Apr 23 2026 19:41
      Cheque # 142
      Subtotal 68.00
      HST 8.84
      TOTAL 76.84
      VISA 76.84
    `,
    "tesseract",
    88,
  );

  assert.equal(parsed.invoiceDate, "2026-04-23");
  assert.equal(parsed.invoiceNumber, "142");
  assert.equal(parsed.amount, 76.84);
});

test("parser handles Canadian pharmacy receipt patterns", () => {
  const parsed = parseInvoiceFieldsFromText(
    `
      SHOPPERS DRUG MART
      Invoice Date 2026/04/23
      Ref # RX-22841
      Subtotal 11.99
      GST 0.60
      Total Due 12.59
    `,
    "tesseract",
    87,
  );

  assert.equal(parsed.invoiceDate, "2026-04-23");
  assert.equal(parsed.invoiceNumber, "RX-22841");
  assert.equal(parsed.amount, 12.59);
});

test("parser handles Canadian gas station receipt patterns", () => {
  const parsed = parseInvoiceFieldsFromText(
    `
      ESSO
      Purchase Date 23 Apr 2026 07:14
      Trans No 081552
      Subtotal 58.15
      HST 7.56
      Amount Paid 65.71
      Interac 65.71
    `,
    "tesseract",
    9,
  );

  assert.equal(parsed.invoiceDate, "2026-04-23");
  assert.equal(parsed.invoiceNumber, "081552");
  assert.equal(parsed.amount, 65.71);
});

test("parser avoids Canadian tax ids and terminal ids when a receipt number exists", () => {
  const parsed = parseInvoiceFieldsFromText(
    `
      COSTCO WHOLESALE CANADA
      Store No 567
      Terminal ID 998211
      Authorization 123456
      HST No 123456789RT0001
      Date 04-23-2026 16:10
      Receipt Number 456712
      Subtotal 129.99
      HST 6.50
      Total 136.49
      Mastercard 136.49
    `,
    "tesseract",
    91,
  );

  assert.equal(parsed.invoiceDate, "2026-04-23");
  assert.equal(parsed.invoiceNumber, "456712");
  assert.equal(parsed.amount, 136.49);
});

test("parser prefers Canadian day-first dates when the receipt context is Canadian", () => {
  const parsed = parseInvoiceFieldsFromText(
    `
      CANADIAN TIRE
      Transaction Date 05/04/2026
      Receipt No 00119
      HST 1.20
      Total 14.99
      Interac 14.99
    `,
    "tesseract",
    85,
  );

  assert.equal(parsed.invoiceDate, "2026-04-05");
  assert.equal(parsed.invoiceNumber, "00119");
});

test("parser keeps supporting US-style ambiguous dates when no Canadian context exists", () => {
  const parsed = parseInvoiceFieldsFromText(
    `
      Order Date 05-04-2026
      Order # A-5512
      Total Due 19.95
    `,
    "tesseract",
    85,
  );

  assert.equal(parsed.invoiceDate, "2026-05-04");
  assert.equal(parsed.invoiceNumber, "A-5512");
  assert.equal(parsed.amount, 19.95);
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
