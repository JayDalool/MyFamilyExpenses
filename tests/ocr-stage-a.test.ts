import assert from "node:assert/strict";
import test from "node:test";
import { parseInvoiceFieldsFromText } from "../lib/ocr/ocr-parsing";
import type { OcrBlock } from "../lib/ocr/types";

// Two real receipts side by side: each cluster has its own header/date/total.
function twoReceiptBlocks(): OcrBlock[] {
  const left = ["STORE A", "Date 2026-05-01", "Bread 3.50", "Milk 4.20", "Total 7.70", "Cash 10.00"];
  const right = ["STORE B", "Date 2026-05-02", "Eggs 2.00", "Juice 3.10", "Total 5.10", "Visa 5.10"];
  const blocks: OcrBlock[] = [];
  left.forEach((text, i) =>
    blocks.push({ text, bbox: [20, i * 30, 140, i * 30 + 20], score: 0.9 }),
  );
  right.forEach((text, i) =>
    blocks.push({ text, bbox: [520, i * 30, 640, i * 30 + 20], score: 0.9 }),
  );
  return blocks;
}

// A single receipt whose item names (left) and prices (right) form two x-columns.
// This must NOT be flagged as multiple receipts.
function singleReceiptColumnBlocks(): OcrBlock[] {
  const items = ["Bread", "Milk", "Eggs", "Juice", "Coffee", "Subtotal", "Tax", "Total"];
  const prices = ["3.50", "4.20", "2.00", "3.10", "6.00", "18.80", "1.20", "20.00"];
  const blocks: OcrBlock[] = [];
  // Left column: item/label names (x ≈ 20–180).
  items.forEach((text, i) =>
    blocks.push({ text, bbox: [20, i * 30, 180, i * 30 + 20], score: 0.9 }),
  );
  // Right column: bare prices, far to the right (x ≈ 520–600).
  prices.forEach((text, i) =>
    blocks.push({ text, bbox: [520, i * 30, 600, i * 30 + 20], score: 0.9 }),
  );
  return blocks;
}

test("bank ATM withdrawal receipt parses safely", () => {
  const result = parseInvoiceFieldsFromText(
    [
      "TD CANADA TRUST ATM",
      "ATM #04321",
      "Fri Jun 20 2014 14:32",
      "Sequence No 002841",
      "Withdrawal $20.00",
      "Available Balance $1,240.55",
      "Account No 1234567",
      "Card xxxx1234",
    ].join("\n"),
    "paddle",
    0.85,
  );

  assert.equal(result.receiptType, "bank_withdrawal");
  // "Fri Jun 20 2014" parses despite the leading weekday.
  assert.equal(result.invoiceDate, "2014-06-20");
  // The withdrawn amount is the expense; the available balance must not be it.
  assert.equal(result.amount, 20);
  assert.ok(result.candidates.amount.some((c) => c.value === 20));
  assert.ok(!result.candidates.amount.some((c) => c.value === 1240.55));
  // Account / card / ATM numbers must never be chosen as the invoice number.
  assert.notEqual(result.invoiceNumber, "1234567");
  assert.notEqual(result.invoiceNumber, "04321");
  assert.ok(!result.candidates.invoiceNumber.some((c) => c.value === "1234567"));
  // A labelled sequence number is an acceptable reference candidate.
  assert.equal(result.invoiceNumber, "002841");
});

test("bank deposit receipt does not invent a 0.00 expense", () => {
  const result = parseInvoiceFieldsFromText(
    [
      "WELLS FARGO",
      "Deposit Receipt",
      "06/20/14",
      "Account Number 9876543210",
      "Deposit Amount $0.00",
      "Available Balance $532.10",
    ].join("\n"),
    "paddle",
    0.85,
  );

  assert.equal(result.receiptType, "bank_deposit");
  assert.equal(result.invoiceDate, "2014-06-20");
  // A 0.00 deposit is not a spend — amount must NOT be auto-selected.
  assert.equal(result.confidence.amount, 0);
  // The account number is never used as an invoice number.
  assert.equal(result.invoiceNumber, "");
  assert.ok(!result.candidates.invoiceNumber.some((c) => c.value === "9876543210"));
  // The deposit receipt warns the user to confirm it is an expense.
  assert.ok(result.warnings.some((w) => /deposit receipt/i.test(w)));
});

test("two receipts in one image are flagged and confidence is lowered", () => {
  const text = [
    "STORE A",
    "Invoice No INV-100",
    "Date 2026-05-01",
    "Total 25.00",
  ].join("\n");

  const single = parseInvoiceFieldsFromText(text, "paddle", 0.9, []);
  const multi = parseInvoiceFieldsFromText(text, "paddle", 0.9, twoReceiptBlocks());

  assert.equal(single.multipleReceipts, false);
  assert.equal(multi.multipleReceipts, true);
  assert.ok(
    multi.warnings.some((w) => /more than one receipt/i.test(w)),
    "expected a multi-receipt warning",
  );
  // Confidence is dampened when multiple receipts are detected.
  assert.ok(multi.confidence.amount < single.confidence.amount);
});

test("a single receipt with an item column and price column is NOT multi-receipt", () => {
  const result = parseInvoiceFieldsFromText(
    [
      "FRESH MART",
      "Bread 3.50",
      "Milk 4.20",
      "Subtotal 7.70",
      "Total 7.70",
    ].join("\n"),
    "paddle",
    0.9,
    singleReceiptColumnBlocks(),
  );

  assert.equal(result.multipleReceipts, false);
  assert.ok(!result.warnings.some((w) => /more than one receipt/i.test(w)));
});

test("a receipt with no invoice number does not invent one", () => {
  const result = parseInvoiceFieldsFromText(
    ["FRESH MART", "2026-05-01", "Bread 3.50", "Milk 4.20", "Total 7.70"].join("\n"),
    "tesseract",
    0.85,
  );

  assert.equal(result.invoiceNumber, "");
  assert.equal(result.confidence.invoiceNumber, 0);
  assert.equal(result.candidates.invoiceNumber.length, 0);
  // Date and amount still parse on a normal retail receipt.
  assert.equal(result.invoiceDate, "2026-05-01");
  assert.equal(result.amount, 7.7);
});

test("retail receipt: total beats subtotal and change is never the amount", () => {
  const result = parseInvoiceFieldsFromText(
    [
      "CAFE",
      "Subtotal 20.00",
      "Tip 3.00",
      "Total 23.00",
      "Cash 30.00",
      "Change 7.00",
    ].join("\n"),
    "tesseract",
    0.85,
  );

  assert.equal(result.amount, 23);
  assert.ok(!result.candidates.amount.some((c) => c.value === 7));
});

test("DD/MM date 31/12/2023 parses correctly", () => {
  const result = parseInvoiceFieldsFromText(
    "Date 31/12/2023\nTotal 10.00",
    "tesseract",
    0.85,
  );
  assert.equal(result.invoiceDate, "2023-12-31");
});

test("ambiguous dates get lower confidence than unambiguous ones", () => {
  const unambiguous = parseInvoiceFieldsFromText(
    "Date 25/12/2023\nTotal 5.00",
    "tesseract",
    0.9,
  );
  const ambiguous = parseInvoiceFieldsFromText(
    "Date 06/07/2023\nTotal 5.00",
    "tesseract",
    0.9,
  );

  assert.ok(unambiguous.confidence.invoiceDate > 0);
  assert.ok(
    ambiguous.confidence.invoiceDate < unambiguous.confidence.invoiceDate,
    "ambiguous day/month date should be less confident",
  );
  // The ambiguity is surfaced in the candidate reasoning.
  assert.ok(
    ambiguous.candidates.invoiceDate.some((c) => /ambiguous/i.test(c.reason)),
  );
});

test("clear cash receipt: confident total/date, no hallucinated invoice", () => {
  const result = parseInvoiceFieldsFromText(
    [
      "CASH RECEIPT",
      "Address: 1234 Lorem Ipsum, Dolor",
      "Tel: 123-456-7890",
      "Date: 01-01-2018     10:35",
      "Item A         40.00",
      "Item B         36.80",
      "Total          84.80",
      "Sub-total      76.80",
      "Sales Tax       8.00",
      "Balance        84.80",
    ].join("\n"),
    "paddle",
    0.9,
  );

  // No invoice number invented from the address / phone / item text.
  assert.equal(result.invoiceNumber, "");
  assert.equal(result.confidence.invoiceNumber, 0);
  assert.equal(result.candidates.invoiceNumber.length, 0);

  // Date parses with medium/high confidence (01-01 is not really ambiguous).
  assert.equal(result.invoiceDate, "2018-01-01");
  assert.ok(
    result.confidence.invoiceDate >= 0.6,
    `date confidence ${result.confidence.invoiceDate} should be >= 0.6`,
  );

  // Total wins; sub-total and balance do not become the amount.
  assert.equal(result.amount, 84.8);
  assert.ok(
    result.confidence.amount >= 0.7,
    `amount confidence ${result.confidence.amount} should be >= 0.7`,
  );

  // No multi-receipt warning (no blocks, single body) and no scary warnings.
  assert.equal(result.multipleReceipts, false);
  assert.ok(!result.warnings.some((w) => /more than one receipt/i.test(w)));
  assert.ok(!result.warnings.some((w) => /could not read/i.test(w)));
});

test("withdrawal amount is exposed as a ranked candidate with its label", () => {
  const result = parseInvoiceFieldsFromText(
    "ATM Withdrawal\nWithdraw $40.00\nAvailable Balance 900.00",
    "paddle",
    0.85,
  );
  const top = result.candidates.amount[0];
  assert.ok(top);
  assert.equal(top.value, 40);
  assert.match(top.sourceLabel, /Withdraw/i);
});
