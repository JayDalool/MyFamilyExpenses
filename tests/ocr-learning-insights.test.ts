import assert from "node:assert/strict";
import test from "node:test";
import {
  summarizeLearningInsights,
  topByCorrectionCount,
  type FeedbackRecord,
} from "../lib/ocr/learning-insights";

function rec(over: Partial<FeedbackRecord> = {}): FeedbackRecord {
  return {
    receiptType: "retail",
    merchantGuess: "Corner Shop",
    provider: "paddle",
    strategy: "ensemble",
    parserVersion: "stage-a3",
    invoiceNumberChanged: false,
    invoiceDateChanged: false,
    amountChanged: false,
    predictedAmount: 10,
    finalAmount: 10,
    predictedInvoiceDate: "2018-01-01",
    finalInvoiceDate: "2018-01-01",
    amountConfidence: 0.9,
    createdAt: "2026-06-14T00:00:00.000Z",
    ...over,
  };
}

test("empty input is safe: zeros and empty lists, no throw", () => {
  const insights = summarizeLearningInsights([]);
  assert.equal(insights.totalRecords, 0);
  assert.equal(insights.amountCorrectionRate.rate, 0);
  assert.equal(insights.dateCorrectionRate.rate, 0);
  assert.equal(insights.invoiceCorrectionRate.rate, 0);
  assert.deepEqual(insights.merchants, []);
  assert.deepEqual(insights.receiptTypes, []);
  assert.deepEqual(insights.providerPerformance, []);
  assert.deepEqual(insights.recentExamples, []);
  assert.deepEqual(insights.correctExamples, []);
  assert.deepEqual(insights.correctedExamples, []);
});

test("correction rates count changed fields over total", () => {
  const insights = summarizeLearningInsights([
    rec({ amountChanged: true }),
    rec({ amountChanged: false }),
    rec({ amountChanged: true, invoiceDateChanged: true }),
    rec({ invoiceNumberChanged: true }),
  ]);
  assert.equal(insights.totalRecords, 4);
  assert.equal(insights.amountCorrectionRate.changed, 2);
  assert.equal(insights.amountCorrectionRate.total, 4);
  assert.equal(insights.amountCorrectionRate.rate, 0.5);
  assert.equal(insights.dateCorrectionRate.changed, 1);
  assert.equal(insights.invoiceCorrectionRate.changed, 1);
});

test("merchant grouping aggregates and skips null/blank merchant guesses", () => {
  const insights = summarizeLearningInsights([
    rec({ merchantGuess: "Cafe A", amountChanged: true }),
    rec({ merchantGuess: "Cafe A", amountChanged: false }),
    rec({ merchantGuess: "Cafe B", amountChanged: true }),
    rec({ merchantGuess: null, amountChanged: true }),
    rec({ merchantGuess: "   ", amountChanged: true }),
  ]);
  const cafeA = insights.merchants.find((m) => m.merchant === "Cafe A");
  assert.ok(cafeA);
  assert.equal(cafeA!.total, 2);
  assert.equal(cafeA!.amountChanged, 1);
  assert.equal(cafeA!.amountChangeRate, 0.5);
  // null and blank merchants are excluded from per-merchant stats.
  assert.equal(insights.merchants.length, 2);
  assert.ok(!insights.merchants.some((m) => m.merchant.trim() === ""));
});

test("receipt-type and provider grouping compute rates", () => {
  const insights = summarizeLearningInsights([
    rec({ receiptType: "bank_withdrawal", invoiceNumberChanged: true, strategy: "single" }),
    rec({ receiptType: "bank_withdrawal", invoiceNumberChanged: true, strategy: "single" }),
    rec({ receiptType: "retail", amountChanged: true, strategy: "ensemble" }),
  ]);
  const bank = insights.receiptTypes.find((t) => t.receiptType === "bank_withdrawal");
  assert.equal(bank!.total, 2);
  assert.equal(bank!.invoiceChangeRate, 1);

  const single = insights.providerPerformance.find((p) => p.strategy === "single");
  assert.equal(single!.total, 2);
  assert.equal(single!.invoiceChangeRate, 1);
  assert.equal(single!.amountChangeRate, 0);
});

test("correct vs corrected examples are separated", () => {
  const insights = summarizeLearningInsights([
    rec({ createdAt: "2026-06-10T00:00:00.000Z", amountChanged: false }),
    rec({ createdAt: "2026-06-11T00:00:00.000Z", amountChanged: true }),
  ]);
  assert.equal(insights.correctExamples.length, 1);
  assert.equal(insights.correctExamples[0].amountChanged, false);
  assert.equal(insights.correctedExamples.length, 1);
  assert.equal(insights.correctedExamples[0].amountChanged, true);
  // recentExamples sorted newest first.
  assert.equal(insights.recentExamples[0].createdAt, "2026-06-11T00:00:00.000Z");
});

test("examples expose ONLY the privacy allowlist (no invoice strings, no raw text)", () => {
  const insights = summarizeLearningInsights([
    rec({ amountChanged: true, predictedAmount: 84.8, finalAmount: 85 }),
  ]);
  const example = insights.recentExamples[0];
  const expectedKeys = [
    "createdAt",
    "merchantGuess",
    "receiptType",
    "provider",
    "predictedAmount",
    "finalAmount",
    "amountChanged",
    "predictedInvoiceDate",
    "finalInvoiceDate",
    "invoiceDateChanged",
    "invoiceNumberChanged",
  ].sort();
  assert.deepEqual(Object.keys(example).sort(), expectedKeys);
  const json = JSON.stringify(insights);
  // Invoice/reference strings and any raw recognition must never appear.
  assert.doesNotMatch(json, /predictedInvoiceNumber|finalInvoiceNumber|rawText|blocks/);
  // Safe values (amounts) are allowed.
  assert.match(json, /84\.8/);
});

test("topByCorrectionCount sorts by corrections then sample size", () => {
  const insights = summarizeLearningInsights([
    rec({ merchantGuess: "Low", amountChanged: false }),
    rec({ merchantGuess: "High", amountChanged: true }),
    rec({ merchantGuess: "High", invoiceDateChanged: true }),
  ]);
  const top = topByCorrectionCount(insights.merchants, 1);
  assert.equal(top.length, 1);
  assert.equal(top[0].merchant, "High");
  assert.equal(top[0].correctionCount, 2);
});
