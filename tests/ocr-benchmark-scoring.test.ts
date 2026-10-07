import assert from "node:assert/strict";
import test from "node:test";
import {
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

test("a receipt read correctly scores correct; tax is unsupported until 6b", () => {
  const score = scoreReceipt(
    result({ amount: 20.97, invoiceDate: "2026-03-14", merchant: "NORTHGATE FRESH MARKET" }),
    expected,
  );
  assert.deepEqual(score, { amount: "correct", date: "correct", vendor: "correct", tax: "unsupported" });
});

test("wrong, missing and skipped are told apart", () => {
  const score = scoreReceipt(
    result({ amount: 20.39, invoiceDate: "", merchant: "" }),
    { ...expected, taxCents: null },
  );
  assert.deepEqual(score, { amount: "wrong", date: "missing", vendor: "missing", tax: "skipped" });

  const noVendorAnswer = scoreReceipt(result({ merchant: "Anything" }), { ...expected, vendor: null });
  assert.equal(noVendorAnswer.vendor, "skipped");
});

test("totals exclude skipped fields from accuracy and count OCR failures", () => {
  const totals = totalScores(
    [
      { amount: "correct", date: "correct", vendor: "skipped", tax: "unsupported" },
      { amount: "wrong", date: "missing", vendor: "correct", tax: "skipped" },
    ],
    1,
  );
  assert.equal(totals.receipts, 3);
  assert.equal(totals.failed, 1);
  assert.equal(totals.fields.amount.accuracy, 0.5);
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
