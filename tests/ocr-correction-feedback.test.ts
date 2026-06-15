import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCorrectionFeedbackPayload,
  isChanged,
  normalizeAmountCents,
  normalizeDate,
  normalizeReference,
  summarizeCandidates,
  type AttemptForFeedback,
} from "../lib/ocr/correction-feedback";

// ── Normalization ────────────────────────────────────────────────────────────

test("normalizeReference trims, lowercases, and nulls empties", () => {
  assert.equal(normalizeReference("  INV-2026-001 "), "inv-2026-001");
  assert.equal(normalizeReference(""), null);
  assert.equal(normalizeReference("   "), null);
  assert.equal(normalizeReference(null), null);
  assert.equal(normalizeReference(undefined), null);
});

test("normalizeDate reduces to bare yyyy-mm-dd", () => {
  assert.equal(normalizeDate("2018-01-01"), "2018-01-01");
  assert.equal(normalizeDate("2018-01-01T00:00:00.000Z"), "2018-01-01");
  assert.equal(normalizeDate("01/02/2018"), null);
  assert.equal(normalizeDate(""), null);
  assert.equal(normalizeDate(null), null);
});

test("normalizeAmountCents is Decimal-safe across number and string", () => {
  assert.equal(normalizeAmountCents(84.8), 8480);
  assert.equal(normalizeAmountCents("84.80"), 8480);
  assert.equal(normalizeAmountCents(0), 0);
  assert.equal(normalizeAmountCents(null), null);
  assert.equal(normalizeAmountCents("not-a-number"), null);
  // Float rounding: 84.80 must not become 8479.
  assert.equal(normalizeAmountCents(84.8), normalizeAmountCents("84.80"));
});

// ── Changed detection ────────────────────────────────────────────────────────

test("isChanged: equal not changed, missing predicted is changed", () => {
  assert.equal(isChanged(8480, 8480), false); // correct OCR
  assert.equal(isChanged(8480, 9999), true); // user corrected
  assert.equal(isChanged(null, 8480), true); // OCR missed
  assert.equal(isChanged(8480, null), true); // value removed
  assert.equal(isChanged(null, null), false); // nothing either side
});

// ── Candidate summary (value-free) ───────────────────────────────────────────

test("summarizeCandidates returns counts + top confidence/source only", () => {
  const summary = summarizeCandidates({
    invoiceNumber: [
      { value: "INV-1", confidence: 0.9, source: "paddle" },
      { value: "INV-2", confidence: 0.4, source: "tesseract" },
    ],
    invoiceDate: [],
    amount: [{ value: 84.8, confidence: 0.95, source: "paddle" }],
    merchant: [{ value: "Store", confidence: 0.5, source: "paddle" }],
  });
  assert.deepEqual(summary.invoiceNumber, {
    count: 2,
    topConfidence: 0.9,
    topSource: "paddle",
  });
  assert.deepEqual(summary.invoiceDate, {
    count: 0,
    topConfidence: null,
    topSource: null,
  });
  assert.equal(summary.amount.count, 1);
  // No candidate `value` strings must appear in the summary.
  assert.doesNotMatch(JSON.stringify(summary), /INV-1|Store|84\.8/);
});

// ── Payload builder ──────────────────────────────────────────────────────────

function makeAttempt(overrides: Partial<AttemptForFeedback> = {}): AttemptForFeedback {
  return {
    id: "attempt-1",
    receiptType: "retail",
    merchantGuess: "Coffee Shop",
    parserVersion: "stage-a3",
    provider: "paddle",
    strategy: "ensemble",
    providersUsed: ["paddle", "tesseract"],
    selectedExtraction: {
      invoiceNumber: "INV-1",
      invoiceDate: "2018-01-01",
      amount: 84.8,
      // Unredacted card text deliberately planted here to prove it is NOT copied.
      merchant: "Coffee Shop Card 4111 1111 1111 1111",
    },
    confidence: { invoiceNumber: 0.9, invoiceDate: 0.8, amount: 0.95 },
    candidates: {
      invoiceNumber: [{ value: "INV-1", confidence: 0.9, source: "paddle" }],
      invoiceDate: [{ value: "2018-01-01", confidence: 0.8, source: "paddle" }],
      amount: [{ value: 84.8, confidence: 0.95, source: "paddle" }],
      // Unredacted card text in a candidate value — must not leak into the row.
      merchant: [{ value: "Card 4111 1111 1111 1111", confidence: 0.5, source: "paddle" }],
    },
    warnings: ["Image is small — please verify the values below."],
    ...overrides,
  };
}

const finalSame = {
  invoiceNumber: "INV-1",
  invoiceDate: "2018-01-01",
  amount: 84.8,
  categoryId: "cat-1",
  paidByUserId: "user-1",
};

test("payload marks all fields unchanged when prediction equals final", () => {
  const payload = buildCorrectionFeedbackPayload(makeAttempt(), finalSame);
  assert.equal(payload.invoiceNumberChanged, false);
  assert.equal(payload.invoiceDateChanged, false);
  assert.equal(payload.amountChanged, false);
  assert.equal(payload.predictedAmount, 84.8);
  assert.equal(payload.finalAmount, 84.8);
  assert.equal(payload.amountConfidence, 0.95);
});

test("payload marks amount changed when final differs", () => {
  const payload = buildCorrectionFeedbackPayload(makeAttempt(), {
    ...finalSame,
    amount: 99.99,
  });
  assert.equal(payload.amountChanged, true);
  assert.equal(payload.predictedAmount, 84.8);
  assert.equal(payload.finalAmount, 99.99);
});

test("payload marks date changed when OCR missed it (predicted empty, final set)", () => {
  const attempt = makeAttempt({
    selectedExtraction: { invoiceNumber: "INV-1", invoiceDate: "", amount: 84.8 },
    confidence: { invoiceNumber: 0.9, invoiceDate: 0, amount: 0.95 },
  });
  const payload = buildCorrectionFeedbackPayload(attempt, finalSame);
  assert.equal(payload.predictedInvoiceDate, null);
  assert.equal(payload.invoiceDateChanged, true);
  assert.equal(payload.invoiceDateConfidence, 0);
});

test("payload marks invoice changed when OCR missed it (generated label as final)", () => {
  const attempt = makeAttempt({
    selectedExtraction: { invoiceNumber: "", invoiceDate: "2018-01-01", amount: 84.8 },
    confidence: { invoiceNumber: 0, invoiceDate: 0.8, amount: 0.95 },
  });
  const payload = buildCorrectionFeedbackPayload(attempt, {
    ...finalSame,
    invoiceNumber: "Coffee Shop 2018-01-01", // generated receipt label
  });
  assert.equal(payload.predictedInvoiceNumber, null);
  assert.equal(payload.finalInvoiceNumber, "Coffee Shop 2018-01-01");
  assert.equal(payload.invoiceNumberChanged, true);
});

test("payload treats amount 0 sentinel as no prediction", () => {
  const attempt = makeAttempt({
    selectedExtraction: { invoiceNumber: "INV-1", invoiceDate: "2018-01-01", amount: 0 },
    confidence: { invoiceNumber: 0.9, invoiceDate: 0.8, amount: 0 },
  });
  const payload = buildCorrectionFeedbackPayload(attempt, finalSame);
  assert.equal(payload.predictedAmount, null);
  assert.equal(payload.amountChanged, true); // missed by OCR
});

test("merchant uses redacted merchantGuess only; no merchant comparison yet", () => {
  const payload = buildCorrectionFeedbackPayload(makeAttempt(), finalSame);
  assert.equal(payload.predictedMerchant, "Coffee Shop");
  assert.equal(payload.finalMerchant, null);
  assert.equal(payload.merchantChanged, null);
});

test("payload never carries raw OCR text, blocks, or unredacted candidate/merchant PII", () => {
  const payload = buildCorrectionFeedbackPayload(makeAttempt(), finalSame);
  // No raw recognition surfaces.
  assert.ok(!("rawText" in payload));
  assert.ok(!("blocks" in payload));
  // Card digits planted in selectedExtraction.merchant and candidate values must
  // not appear anywhere in the serialized durable payload.
  assert.doesNotMatch(JSON.stringify(payload), /4111/);
});
