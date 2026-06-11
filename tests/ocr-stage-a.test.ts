import assert from "node:assert/strict";
import test from "node:test";
import { parseInvoiceFieldsFromText } from "../lib/ocr/ocr-parsing";
import type { OcrBlock } from "../lib/ocr/types";

// Build N blocks split into two x-clusters to simulate two receipts side by side.
function twoColumnBlocks(): OcrBlock[] {
  const blocks: OcrBlock[] = [];
  // Left receipt column (x ≈ 20–120).
  for (let i = 0; i < 6; i += 1) {
    blocks.push({ text: `left ${i}`, bbox: [20, i * 30, 120, i * 30 + 20], score: 0.9 });
  }
  // Right receipt column (x ≈ 520–620), a wide horizontal gap away.
  for (let i = 0; i < 6; i += 1) {
    blocks.push({ text: `right ${i}`, bbox: [520, i * 30, 620, i * 30 + 20], score: 0.9 });
  }
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
  const multi = parseInvoiceFieldsFromText(text, "paddle", 0.9, twoColumnBlocks());

  assert.equal(single.multipleReceipts, false);
  assert.equal(multi.multipleReceipts, true);
  assert.ok(
    multi.warnings.some((w) => /more than one receipt/i.test(w)),
    "expected a multi-receipt warning",
  );
  // Confidence is dampened when multiple receipts are detected.
  assert.ok(multi.confidence.amount < single.confidence.amount);
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
