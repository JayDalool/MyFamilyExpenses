import assert from "node:assert/strict";
import test from "node:test";
import {
  finalExpenseSchema,
  friendlyExpenseError,
} from "../lib/validation/expense";
import {
  generateReceiptLabel,
  isGeneratedReceiptLabel,
} from "../lib/ocr/receipt-label";
import { parseInvoiceFieldsFromText } from "../lib/ocr/ocr-parsing";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

// ── Receipt label generator ──────────────────────────────────────────────────

test("generateReceiptLabel builds a merchant+date label", () => {
  assert.equal(generateReceiptLabel("McDonald's", "2018-01-01"), "McDonald-s-2018-01-01");
  assert.equal(generateReceiptLabel("Downtown Market", "2024-06-11"), "Downtown-Market-2024-06-11");
});

test("generateReceiptLabel falls back to Receipt and today's date", () => {
  assert.equal(generateReceiptLabel("", "2018-01-01"), "Receipt-2018-01-01");
  assert.equal(generateReceiptLabel(null, null, () => "2024-06-11"), "Receipt-2024-06-11");
  // An invalid date is replaced by today.
  assert.equal(generateReceiptLabel("Cafe", "nope", () => "2024-06-11"), "Cafe-2024-06-11");
});

test("isGeneratedReceiptLabel recognizes generated labels", () => {
  assert.equal(isGeneratedReceiptLabel("McDonalds-2018-01-01"), true);
  assert.equal(isGeneratedReceiptLabel("INV-2026-001"), false);
});

// ── Friendly error mapping (never raw Zod) ───────────────────────────────────

test("a missing invoiceNumber never surfaces a raw Zod 'expected string' error", () => {
  const parsed = finalExpenseSchema.safeParse({
    categoryId: VALID_UUID,
    invoiceDate: "2018-01-01",
    amount: 84.8,
    // invoiceNumber intentionally absent → Zod's raw message is
    // "Invalid input: expected string, received undefined".
  });
  assert.equal(parsed.success, false);
  if (parsed.success) return;

  const friendly = friendlyExpenseError(parsed.error);
  assert.doesNotMatch(friendly, /expected string|received undefined|invalid input/i);
  assert.match(friendly, /invoice or reference number/i);
});

test("missing date and amount map to friendly, field-specific messages", () => {
  const noDate = finalExpenseSchema.safeParse({
    categoryId: VALID_UUID,
    invoiceNumber: "INV-1",
    amount: 10,
  });
  assert.equal(noDate.success, false);
  if (!noDate.success) {
    assert.match(friendlyExpenseError(noDate.error), /receipt date/i);
  }

  const noAmount = finalExpenseSchema.safeParse({
    categoryId: VALID_UUID,
    invoiceNumber: "INV-1",
    invoiceDate: "2018-01-01",
  });
  assert.equal(noAmount.success, false);
  if (!noAmount.success) {
    assert.match(friendlyExpenseError(noAmount.error), /amount/i);
  }
});

test("finalExpenseSchema accepts a generated label with valid date/amount", () => {
  const parsed = finalExpenseSchema.safeParse({
    categoryId: VALID_UUID,
    invoiceNumber: generateReceiptLabel("Cash Receipt", "2018-01-01"),
    invoiceDate: "2018-01-01",
    amount: 84.8,
  });
  assert.equal(parsed.success, true);
});

// ── Merchant extraction ──────────────────────────────────────────────────────

test("merchant is extracted from the top of the receipt, not used as invoice", () => {
  const result = parseInvoiceFieldsFromText(
    [
      "CASH RECEIPT",
      "Address: 1234 Lorem Ipsum, Dolor",
      "Tel: 123-456-7890",
      "Date: 01-01-2018 10:35",
      "Total 84.80",
    ].join("\n"),
    "paddle",
    0.9,
  );

  assert.match(result.merchant, /CASH RECEIPT/i);
  assert.ok(result.candidates.merchant.length > 0);
  // Merchant must never leak into the invoice number.
  assert.equal(result.invoiceNumber, "");
  assert.notEqual(result.merchant, result.invoiceNumber || "__none__");
});

test("a branded merchant name is captured from the first line", () => {
  const result = parseInvoiceFieldsFromText(
    ["McDonald's", "123 Main St", "Date: 2024-06-11", "Total 12.50"].join("\n"),
    "paddle",
    0.9,
  );
  assert.match(result.merchant, /McDonald/i);
});

test("address and phone lines are not chosen as the merchant", () => {
  const result = parseInvoiceFieldsFromText(
    ["Walmart", "Address: 99 Market Road", "Tel 204-555-1212", "Total 5.00"].join("\n"),
    "paddle",
    0.9,
  );
  assert.match(result.merchant, /Walmart/i);
});

test("extraction candidates carry a source tag", () => {
  const result = parseInvoiceFieldsFromText("Total 84.80", "paddle", 0.9);
  assert.ok(result.candidates.amount[0]);
  assert.equal(result.candidates.amount[0].source, "paddle");
});
