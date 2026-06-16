import assert from "node:assert/strict";
import test from "node:test";
import { summarizeLearningInsights, type FeedbackRecord } from "../lib/ocr/learning-insights";
import {
  buildTemplateRecommendations,
  MIN_MERCHANT_SAMPLES,
} from "../lib/ocr/templates/recommendations";
import { findMerchantTemplate, MERCHANT_TEMPLATES } from "../lib/ocr/templates";

function rec(over: Partial<FeedbackRecord> = {}): FeedbackRecord {
  return {
    receiptType: "retail",
    merchantGuess: "Shop",
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

function repeat(n: number, over: Partial<FeedbackRecord>): FeedbackRecord[] {
  return Array.from({ length: n }, () => rec(over));
}

test("no recommendation below the minimum merchant sample size", () => {
  const insights = summarizeLearningInsights(
    repeat(MIN_MERCHANT_SAMPLES - 1, { merchantGuess: "Tiny", amountChanged: true }),
  );
  const recs = buildTemplateRecommendations(insights);
  assert.ok(!recs.some((r) => r.scope === "merchant" && r.target === "Tiny"));
});

test("high amount-change merchant yields an ADD_MERCHANT_TEMPLATE warning", () => {
  const insights = summarizeLearningInsights([
    ...repeat(3, { merchantGuess: "Gas Mart", amountChanged: true }),
    ...repeat(1, { merchantGuess: "Gas Mart", amountChanged: false }),
  ]);
  const rec = buildTemplateRecommendations(insights).find(
    (r) => r.scope === "merchant" && r.target === "Gas Mart",
  );
  assert.ok(rec);
  assert.equal(rec!.kind, "ADD_MERCHANT_TEMPLATE");
  assert.equal(rec!.severity, "warning");
  assert.equal(rec!.sampleSize, 4);
});

test("high-success merchant yields NO_TEMPLATE_NEEDED", () => {
  const insights = summarizeLearningInsights(
    repeat(10, { merchantGuess: "Reliable Co", amountChanged: false }),
  );
  const rec = buildTemplateRecommendations(insights).find(
    (r) => r.scope === "merchant" && r.target === "Reliable Co",
  );
  assert.ok(rec);
  assert.equal(rec!.kind, "NO_TEMPLATE_NEEDED");
  assert.equal(rec!.severity, "info");
});

test("bank receipts with high invoice-change rate suggest keeping invoice optional", () => {
  const insights = summarizeLearningInsights(
    repeat(6, {
      receiptType: "bank_withdrawal",
      merchantGuess: null,
      invoiceNumberChanged: true,
    }),
  );
  const rec = buildTemplateRecommendations(insights).find(
    (r) => r.kind === "KEEP_INVOICE_OPTIONAL",
  );
  assert.ok(rec);
  assert.equal(rec!.scope, "receiptType");
  assert.equal(rec!.target, "bank_withdrawal");
});

test("receipt type with high amount-change rate triggers REVIEW_AMOUNT_RULES", () => {
  const insights = summarizeLearningInsights(
    repeat(8, { receiptType: "restaurant", merchantGuess: null, amountChanged: true }),
  );
  const rec = buildTemplateRecommendations(insights).find(
    (r) => r.kind === "REVIEW_AMOUNT_RULES" && r.target === "restaurant",
  );
  assert.ok(rec);
  assert.equal(rec!.severity, "warning");
});

test("recommendations are sorted with warnings first", () => {
  const insights = summarizeLearningInsights([
    ...repeat(10, { merchantGuess: "Good", amountChanged: false }), // info
    ...repeat(4, { merchantGuess: "Bad", amountChanged: true }), // warning
  ]);
  const recs = buildTemplateRecommendations(insights);
  assert.ok(recs.length >= 2);
  assert.equal(recs[0].severity, "warning");
});

// ── Template skeleton sanity ─────────────────────────────────────────────────

test("generic cash receipt template matches cash receipts but not invoices", () => {
  assert.ok(findMerchantTemplate("CASH RECEIPT"));
  assert.ok(findMerchantTemplate("Cash Sale #42"));
  // Negative pattern: a tax invoice must not match the cash-receipt template.
  assert.equal(findMerchantTemplate("Cash receipt tax invoice"), null);
  assert.equal(findMerchantTemplate("Starbucks"), null);
  assert.equal(findMerchantTemplate(null), null);
});

test("template registry entries are structurally complete", () => {
  for (const t of MERCHANT_TEMPLATES) {
    assert.ok(t.id);
    assert.ok(t.merchantPattern instanceof RegExp);
    assert.ok(t.amountRules);
    assert.ok(t.dateRules);
    assert.ok(t.invoiceRules);
  }
});
