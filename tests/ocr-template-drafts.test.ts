import assert from "node:assert/strict";
import test from "node:test";
import { summarizeLearningInsights, type FeedbackRecord } from "../lib/ocr/learning-insights";
import { buildTemplateRecommendations } from "../lib/ocr/templates/recommendations";
import {
  generateTemplateDraft,
  validateTemplateDraft,
  type TemplateDraft,
} from "../lib/ocr/templates/drafts";

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

const repeat = (n: number, over: Partial<FeedbackRecord>) =>
  Array.from({ length: n }, () => rec(over));

function addMerchantRec(merchant: string, changed: number, total: number) {
  const records = [
    ...repeat(changed, { merchantGuess: merchant, amountChanged: true }),
    ...repeat(total - changed, { merchantGuess: merchant, amountChanged: false }),
  ];
  const insights = summarizeLearningInsights(records);
  const found = buildTemplateRecommendations(insights).find(
    (r) => r.scope === "merchant" && r.target === merchant && r.kind === "ADD_MERCHANT_TEMPLATE",
  );
  return found;
}

// ── Generation ───────────────────────────────────────────────────────────────

test("draft is generated for an ADD_MERCHANT_TEMPLATE recommendation", () => {
  const r = addMerchantRec("Gas Mart", 4, 4);
  assert.ok(r);
  const draft = generateTemplateDraft(r!);
  assert.ok(draft);
  assert.equal(draft!.status, "draft");
  assert.equal(draft!.source, "learning-insights");
  assert.equal(draft!.evidence.target, "Gas Mart");
  assert.match(draft!.merchantPattern, /Gas Mart/);
  // Generated draft must validate clean.
  const v = validateTemplateDraft(draft);
  assert.equal(v.valid, true, JSON.stringify(v.errors));
});

test("no draft for non-merchant recommendations", () => {
  const insights = summarizeLearningInsights(
    repeat(6, { receiptType: "bank_withdrawal", merchantGuess: null, invoiceNumberChanged: true }),
  );
  const keep = buildTemplateRecommendations(insights).find(
    (r) => r.kind === "KEEP_INVOICE_OPTIONAL",
  );
  assert.ok(keep);
  assert.equal(generateTemplateDraft(keep!), null);
});

test("empty insights produce no recommendations and no drafts", () => {
  const insights = summarizeLearningInsights([]);
  const recs = buildTemplateRecommendations(insights);
  assert.deepEqual(recs, []);
  assert.deepEqual(
    recs.map(generateTemplateDraft).filter(Boolean),
    [],
  );
});

// ── Risk classification ──────────────────────────────────────────────────────

test("risk is amount-driven: high / medium / low", () => {
  assert.equal(addMerchantRec("AlwaysWrong", 10, 10)!.riskLevel, "high"); // 100%
  assert.equal(addMerchantRec("OftenWrong", 6, 10)!.riskLevel, "medium"); // 60%

  const lowInsights = summarizeLearningInsights(
    repeat(10, { merchantGuess: "Reliable", amountChanged: false }),
  );
  const low = buildTemplateRecommendations(lowInsights).find((r) => r.target === "Reliable");
  assert.ok(low);
  assert.equal(low!.riskLevel, "low");

  // A missing-invoice (bank) suggestion is never high risk (no financial harm).
  const bank = summarizeLearningInsights(
    repeat(6, { receiptType: "transfer", merchantGuess: null, invoiceNumberChanged: true }),
  );
  const keep = buildTemplateRecommendations(bank).find((r) => r.kind === "KEEP_INVOICE_OPTIONAL");
  assert.equal(keep!.riskLevel, "low");
});

// ── Validation ───────────────────────────────────────────────────────────────

function validDraft(): TemplateDraft {
  return generateTemplateDraft(addMerchantRec("Cafe", 4, 4)!)!;
}

test("validation requires merchantPattern and receiptType", () => {
  assert.equal(validateTemplateDraft({}).valid, false);
  assert.equal(validateTemplateDraft({ receiptType: "any" }).valid, false);
  assert.equal(validateTemplateDraft({ merchantPattern: "X" }).valid, false);
});

test("validation rejects rawText / blocks fields", () => {
  const withRaw = { ...validDraft(), rawText: "secret receipt text" };
  const r1 = validateTemplateDraft(withRaw);
  assert.equal(r1.valid, false);
  assert.ok(r1.errors.some((e) => /rawText|blocks/.test(e)));

  const withBlocks = { ...validDraft(), blocks: [{ text: "x" }] };
  assert.equal(validateTemplateDraft(withBlocks).valid, false);
});

test("validation rejects card-like and long digit sequences", () => {
  const withCard = { ...validDraft(), notes: "card 4111 1111 1111 1111" };
  assert.equal(validateTemplateDraft(withCard).valid, false);

  const withAccount = { ...validDraft(), notes: "account 123456789012" };
  assert.equal(validateTemplateDraft(withAccount).valid, false);
});

test("validation warns (but does not block) on risky preferred amount labels", () => {
  const risky = {
    ...validDraft(),
    amountRules: { preferLabels: ["subtotal", "total"], avoidLabels: [] },
  };
  const result = validateTemplateDraft(risky);
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((w) => /subtotal/.test(w)));
});

test("generated draft never serializes raw text, blocks, or card digits", () => {
  const draft = validDraft();
  const json = JSON.stringify(draft);
  assert.doesNotMatch(json, /rawText|blocks/);
  assert.doesNotMatch(json, /\b(?:\d[ -]?){13,19}\b/);
  assert.doesNotMatch(json, /\d{7,}/);
});
