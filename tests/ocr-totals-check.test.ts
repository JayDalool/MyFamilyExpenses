import assert from "node:assert/strict";
import test from "node:test";
import { mergeExtractions } from "../lib/ocr/merge";
import {
  parseInvoiceFieldsFromText,
  UNVERIFIED_CONFIDENCE_CAP,
  VERIFIED_CONFIDENCE,
} from "../lib/ocr/ocr-parsing";
import { checkReceiptTotals } from "../lib/ocr/totals-check";
import { SYNTHETIC_RECEIPTS } from "./fixtures/receipt-images/receipts";

test("every generated receipt's total and tax are proven by its own arithmetic", () => {
  for (const receipt of SYNTHETIC_RECEIPTS) {
    const totals = checkReceiptTotals(receipt.lines);
    assert.equal(totals.verifiedTotalCents, receipt.expected.amountCents, `${receipt.name}: total`);
    assert.ok(totals.totalChecks.length > 0, `${receipt.name}: at least one check passed`);
    assert.equal(totals.taxCents, receipt.expected.taxCents, `${receipt.name}: tax`);
  }
});

test("a label and its amount on separate lines (PP-OCR boxes) still pair up", () => {
  const totals = checkReceiptTotals([
    "SUBTOTAL", "80.69", "GST", "2.17", "PST", "3.04", "TOTAL", "85.90", "CREDIT", "85.90",
  ]);
  assert.equal(totals.verifiedTotalCents, 8590);
  assert.deepEqual(totals.totalChecks, ["subtotal + tax", "card payment"]);
  assert.equal(totals.taxCents, 521);
  assert.equal(totals.taxVerified, true);
});

test("the total paid includes the tip, not the pre-tip total that also adds up", () => {
  const totals = checkReceiptTotals([
    "Subtotal 30.00", "GST 1.50", "Total 31.50", "Tip 5.00", "Amount Paid 36.50",
  ]);
  assert.equal(totals.verifiedTotalCents, 3650);
  assert.ok(totals.totalChecks.includes("total + tip"));
  assert.equal(totals.tipCents, 500);
});

test("cash minus change proves a total with no card line", () => {
  const totals = checkReceiptTotals(["TOTAL 11.00", "CASH 20.00", "CHANGE 9.00"]);
  assert.equal(totals.verifiedTotalCents, 1100);
  assert.deepEqual(totals.totalChecks, ["cash - change"]);
  assert.equal(totals.taxCents, null);
});

test("a bill's previous balance and payment are ignored; charges plus tax prove the amount due", () => {
  const totals = checkReceiptTotals([
    "Previous balance 84.10",
    "Payment received -84.10",
    "Basic monthly charge 14.25",
    "Energy 612 kWh 62.53",
    "GST 3.84",
    "Amount due 80.62",
  ]);
  assert.equal(totals.verifiedTotalCents, 8062);
  assert.deepEqual(totals.totalChecks, ["items + tax"]);
  assert.equal(totals.taxCents, 384);
});

test("a lone total with nothing to check it against is not verified", () => {
  const totals = checkReceiptTotals(["TOTAL 12.00"]);
  assert.equal(totals.verifiedTotalCents, null);
  assert.deepEqual(totals.totalChecks, []);
});

test("percentages, litres and dotted dates are not money", () => {
  const totals = checkReceiptTotals([
    "05.05.2026",
    "38.214 L @ 1.389",
    "QST 9.975% 1.00",
    "GST 5% 0.50",
    "Subtotal 10.00",
    "Total 11.50",
    "VISA 11.50",
  ]);
  assert.equal(totals.verifiedTotalCents, 1150);
  assert.equal(totals.taxCents, 150);
});

test("a GST registration number line does not borrow the next line's amount as tax", () => {
  const totals = checkReceiptTotals([
    "GST/HST # 123456789 RT0001", "5.49", "Subtotal 5.49", "GST 0.27", "Total 5.76", "DEBIT 5.76",
  ]);
  assert.equal(totals.verifiedTotalCents, 576);
  assert.equal(totals.taxCents, 27);
});

test("a suggested-tip table never turns into the tip that was paid", () => {
  const totals = checkReceiptTotals([
    "Subtotal 30.00", "GST 1.50", "Total 31.50",
    "Suggested tip:", "15% Tip 4.73 Total 36.23", "18% Tip 5.67 Total 37.17", "20% Tip 6.30 Total 37.80",
  ]);
  assert.equal(totals.verifiedTotalCents, 3150);
  assert.equal(totals.tipCents, null);
});

test("paying the exact total in cash counts as a check", () => {
  const totals = checkReceiptTotals(["TOTAL 11.00", "CASH 11.00"]);
  assert.equal(totals.verifiedTotalCents, 1100);
  assert.deepEqual(totals.totalChecks, ["cash payment"]);
});

test("Manitoba RST is read as tax", () => {
  const totals = checkReceiptTotals(["Subtotal 100.00", "GST 5.00", "RST 7% 7.00", "Total 112.00"]);
  assert.equal(totals.verifiedTotalCents, 11200);
  assert.equal(totals.taxCents, 1200);
  assert.equal(totals.taxVerified, true);
});

test("a tax larger than any Canadian rate allows is dropped", () => {
  const totals = checkReceiptTotals(["Subtotal 10.00", "GST 5.00", "Total 15.00", "DEBIT 15.00"]);
  assert.equal(totals.verifiedTotalCents, 1500);
  assert.equal(totals.taxCents, null);
});

test("the parser shows a checked total green and an unchecked one amber", () => {
  const checked = parseInvoiceFieldsFromText(
    ["NORTHGATE FRESH MARKET", "2026-03-14", "SUBTOTAL 20.39", "GST 0.24", "PST 0.34", "TOTAL 20.97", "DEBIT 20.97"].join("\n"),
    "test",
    0.9,
  );
  assert.equal(checked.amount, 20.97);
  assert.equal(checked.amountVerified, true);
  assert.ok(checked.confidence.amount >= VERIFIED_CONFIDENCE);
  assert.deepEqual(checked.tax, { value: 0.58, confidence: VERIFIED_CONFIDENCE, verified: true });

  const unchecked = parseInvoiceFieldsFromText(["SOME STORE", "2026-03-14", "TOTAL 20.97"].join("\n"), "test", 0.9);
  assert.equal(unchecked.amount, 20.97);
  assert.equal(unchecked.amountVerified, false);
  assert.ok(unchecked.confidence.amount <= UNVERIFIED_CONFIDENCE_CAP);
  assert.equal(unchecked.tax, undefined);
});

test("a misread total loses to the printed total the arithmetic proves", () => {
  // OCR read "10.80" on the total line; the card line and the sum say 10.50.
  const result = parseInvoiceFieldsFromText(
    ["CORNER CAFE", "2026-03-14", "Subtotal 10.00", "GST 0.50", "Total Due 10.80", "VISA 10.50"].join("\n"),
    "test",
    0.9,
  );
  assert.equal(result.amount, 10.5);
  assert.equal(result.amountVerified, true);
  assert.ok(result.confidence.amount >= VERIFIED_CONFIDENCE);
});

test("two engines agreeing raise an unchecked amount but never to green", () => {
  const text = ["SOME STORE", "2026-03-14", "TOTAL 20.97"].join("\n");
  const a = parseInvoiceFieldsFromText(text, "paddle", 0.9);
  const b = parseInvoiceFieldsFromText(text, "tesseract", 0.9);
  const merged = mergeExtractions(a, b);
  assert.equal(merged.amount, 20.97);
  assert.equal(merged.amountVerified, false);
  assert.ok(merged.confidence.amount > a.confidence.amount, "agreement still counts for something");
  assert.ok(merged.confidence.amount < 0.7, "but only arithmetic makes it green");
});

test("a verified engine result and its tax survive the merge", () => {
  const checkedText = ["STORE", "2026-03-14", "SUBTOTAL 20.39", "GST 0.58", "TOTAL 20.97", "DEBIT 20.97"].join("\n");
  const verified = parseInvoiceFieldsFromText(checkedText, "paddle", 0.9);
  const other = parseInvoiceFieldsFromText(["STORE", "TOTAL 20.97"].join("\n"), "tesseract", 0.9);
  const merged = mergeExtractions(other, verified);
  assert.equal(merged.amountVerified, true);
  assert.ok(merged.confidence.amount >= 0.7);
  assert.equal(merged.tax?.value, 0.58);
  assert.equal(merged.tax?.verified, true);
});
