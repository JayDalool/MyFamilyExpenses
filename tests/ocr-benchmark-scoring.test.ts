import assert from "node:assert/strict";
import test from "node:test";
import {
  GREEN_CONFIDENCE,
  scoreReceipt,
  totalScores,
  vendorMatches,
  type BenchmarkExpected,
} from "../lib/ocr/benchmark";
import { createEmptyOcrResult } from "../lib/ocr/ocr-parsing";
import type { OcrResult } from "../lib/ocr/types";
import { parseArgs } from "../scripts/ocr-bench/real";
import { SYNTHETIC_RECEIPTS } from "./fixtures/receipt-images/receipts";

const expected: BenchmarkExpected = {
  amountCents: 2097,
  invoiceDate: "2026-03-14",
  vendor: "Northgate Fresh Market",
  taxCents: 58,
};

function result(overrides: Partial<OcrResult>): OcrResult {
  return { ...createEmptyOcrResult("tesseract"), ...overrides };
}

test("vendor matching tolerates store numbers and case, not unrelated names", () => {
  assert.ok(vendorMatches("COSTCO WHOLESALE #552", "Costco"));
  assert.ok(vendorMatches("Wal-Mart", "WALMART"));
  assert.ok(!vendorMatches("Esso", "Costco"));
  // Too short to trust a containment match.
  assert.ok(!vendorMatches("ab", "Abc Foods"));
  assert.ok(!vendorMatches("", "Costco"));
});

test("a receipt read correctly scores correct, tax included", () => {
  const score = scoreReceipt(
    result({
      amount: 20.97,
      invoiceDate: "2026-03-14",
      merchant: "NORTHGATE FRESH MARKET",
      tax: { value: 0.58, confidence: 0.95, verified: true },
    }),
    expected,
  );
  assert.deepEqual(score, { amount: "correct", date: "correct", vendor: "correct", tax: "correct" });
});

test("wrong, flagged, missing and skipped are told apart", () => {
  const confident = { invoiceNumber: 0, invoiceDate: 0.9, amount: 0.95 };
  const shownGreen = scoreReceipt(
    result({ amount: 20.39, invoiceDate: "2026-03-15", confidence: confident, merchant: "" }),
    { ...expected, taxCents: null },
  );
  assert.deepEqual(shownGreen, { amount: "wrong", date: "wrong", vendor: "missing", tax: "skipped" });

  // Under GREEN_CONFIDENCE the review step shows amber, so a wrong value is flagged.
  const shownAmber = scoreReceipt(
    result({
      amount: 20.39,
      invoiceDate: "2026-03-15",
      confidence: { invoiceNumber: 0, invoiceDate: 0.5, amount: GREEN_CONFIDENCE - 0.01 },
      tax: { value: 0.24, confidence: 0.6, verified: false },
    }),
    expected,
  );
  assert.equal(shownAmber.amount, "flagged");
  assert.equal(shownAmber.date, "flagged");
  assert.equal(shownAmber.tax, "flagged");

  const noTaxRead = scoreReceipt(result({}), expected);
  assert.equal(noTaxRead.tax, "missing");

  const noVendorAnswer = scoreReceipt(result({ merchant: "Anything" }), { ...expected, vendor: null });
  assert.equal(noVendorAnswer.vendor, "skipped");
});

test("totals exclude skipped fields from accuracy and count OCR failures", () => {
  const totals = totalScores(
    [
      { amount: "correct", date: "correct", vendor: "skipped", tax: "missing" },
      { amount: "flagged", date: "missing", vendor: "correct", tax: "skipped" },
    ],
    1,
  );
  assert.equal(totals.receipts, 3);
  assert.equal(totals.failed, 1);
  assert.equal(totals.fields.amount.accuracy, 0.5);
  assert.equal(totals.fields.amount.flagged, 1);
  assert.equal(totals.fields.vendor.scored, 1);
  assert.equal(totals.fields.vendor.accuracy, 1);
  assert.equal(totals.fields.tax.accuracy, 0);
});

test("generated receipts are internally consistent", () => {
  for (const receipt of SYNTHETIC_RECEIPTS) {
    const text = receipt.lines.join("\n");
    const amount = (receipt.expected.amountCents / 100).toFixed(2);
    assert.ok(text.includes(amount), `${receipt.name}: expected amount ${amount} is printed`);
    if (receipt.expected.vendor) {
      assert.ok(
        vendorMatches(receipt.lines[0], receipt.expected.vendor),
        `${receipt.name}: first line is the vendor`,
      );
    }
  }
});

test("the saved-expense runner refuses to run without an explicit scope", () => {
  assert.throws(() => parseArgs([]), /--user .* or --household/);
  assert.throws(() => parseArgs(["--household", "not-a-uuid"]), /uuid/);
  assert.throws(() => parseArgs(["--limit", "0", "--user", "a@b.c"]), /positive/);
  assert.deepEqual(parseArgs(["--user", " Osama@Example.com ", "--limit", "50"]), {
    emails: ["osama@example.com"],
    householdIds: [],
    limit: 50,
  });
});
