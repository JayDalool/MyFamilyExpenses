import assert from "node:assert/strict";
import test from "node:test";
import { mergeExtractions } from "../lib/ocr/merge";
import {
  extractInvoiceData,
  fallbackReasonFor,
  resolveOcrStrategy,
} from "../lib/ocr/ocr.service";
import { OcrConfigError } from "../lib/ocr/ocr-errors";
import type { OcrAmountCandidate, OcrResult, OcrTextCandidate } from "../lib/ocr/types";

function amountCandidate(value: number, confidence: number): OcrAmountCandidate {
  return { value, confidence, sourceLabel: "Total", reason: "Labelled \"Total\"" };
}
function textCandidate(value: string, confidence: number): OcrTextCandidate {
  return { value, confidence, sourceLabel: "Date", reason: "ISO date" };
}

function makeResult(overrides: Partial<OcrResult> = {}): OcrResult {
  return {
    invoiceNumber: "",
    invoiceDate: "",
    amount: 0,
    provider: "paddle",
    confidence: { invoiceNumber: 0, invoiceDate: 0, amount: 0 },
    receiptType: "retail",
    multipleReceipts: false,
    warnings: [],
    candidates: { invoiceNumber: [], invoiceDate: [], amount: [] },
    ...overrides,
  };
}

function withEnv(overrides: Record<string, string | undefined>, run: () => void) {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    original[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  try {
    run();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

// ── Candidate merge rules ────────────────────────────────────────────────────

test("agreement between engines boosts amount confidence", () => {
  const primary = makeResult({
    amount: 84.8,
    confidence: { invoiceNumber: 0, invoiceDate: 0, amount: 0.8 },
    candidates: { invoiceNumber: [], invoiceDate: [], amount: [amountCandidate(84.8, 0.8)] },
  });
  const secondary = makeResult({
    provider: "tesseract",
    amount: 84.8,
    confidence: { invoiceNumber: 0, invoiceDate: 0, amount: 0.7 },
    candidates: { invoiceNumber: [], invoiceDate: [], amount: [amountCandidate(84.8, 0.7)] },
  });

  const merged = mergeExtractions(primary, secondary);

  assert.equal(merged.amount, 84.8);
  assert.ok(merged.confidence.amount > 0.8, "agreement should boost above each engine");
  assert.match(merged.candidates.amount[0].reason, /both engines/i);
});

test("a field the primary missed is filled from the fallback engine", () => {
  const primary = makeResult({
    amount: 84.8,
    confidence: { invoiceNumber: 0, invoiceDate: 0, amount: 0.8 },
    candidates: { invoiceNumber: [], invoiceDate: [], amount: [amountCandidate(84.8, 0.8)] },
  });
  const secondary = makeResult({
    provider: "tesseract",
    invoiceDate: "2018-01-01",
    confidence: { invoiceNumber: 0, invoiceDate: 0.75, amount: 0 },
    candidates: {
      invoiceNumber: [],
      invoiceDate: [textCandidate("2018-01-01", 0.75)],
      amount: [],
    },
  });

  const merged = mergeExtractions(primary, secondary);

  assert.equal(merged.invoiceDate, "2018-01-01");
  assert.equal(merged.confidence.invoiceDate, 0.75);
  assert.equal(merged.amount, 84.8);
});

test("conflicting amounts are both surfaced and confidence is lowered", () => {
  const primary = makeResult({
    amount: 84.8,
    confidence: { invoiceNumber: 0, invoiceDate: 0, amount: 0.8 },
    candidates: { invoiceNumber: [], invoiceDate: [], amount: [amountCandidate(84.8, 0.8)] },
  });
  const secondary = makeResult({
    provider: "tesseract",
    amount: 90.0,
    confidence: { invoiceNumber: 0, invoiceDate: 0, amount: 0.7 },
    candidates: { invoiceNumber: [], invoiceDate: [], amount: [amountCandidate(90.0, 0.7)] },
  });

  const merged = mergeExtractions(primary, secondary);

  // Higher-confidence value wins, but confidence is dampened for review.
  assert.equal(merged.amount, 84.8);
  assert.ok(merged.confidence.amount < 0.8);
  // Both values remain visible as candidates.
  assert.ok(merged.candidates.amount.some((c) => c.value === 84.8));
  assert.ok(merged.candidates.amount.some((c) => c.value === 90.0));
  assert.ok(merged.warnings.some((w) => /different amounts/i.test(w)));
});

// ── Fallback decision ────────────────────────────────────────────────────────

test("fallback is NOT triggered when the primary result is strong", () => {
  const strong = makeResult({
    invoiceDate: "2026-05-01",
    amount: 84.8,
    confidence: { invoiceNumber: 0, invoiceDate: 0.78, amount: 0.82 },
  });
  assert.equal(fallbackReasonFor(strong, "A".repeat(80)), null);
});

test("fallback IS triggered when critical fields are weak", () => {
  const lowAmount = makeResult({
    confidence: { invoiceNumber: 0, invoiceDate: 0.75, amount: 0.4 },
  });
  assert.equal(fallbackReasonFor(lowAmount, "A".repeat(80)), "low_amount_confidence");

  const lowDate = makeResult({
    confidence: { invoiceNumber: 0, invoiceDate: 0.3, amount: 0.85 },
  });
  assert.equal(fallbackReasonFor(lowDate, "A".repeat(80)), "low_date_confidence");

  const strongFields = makeResult({
    confidence: { invoiceNumber: 0, invoiceDate: 0.8, amount: 0.85 },
  });
  // Strong fields but almost no OCR text → still worth a second look.
  assert.equal(fallbackReasonFor(strongFields, "short"), "short_text");
});

// ── Strategy config ──────────────────────────────────────────────────────────

test("OCR_STRATEGY validates and defaults to single", () => {
  withEnv({ OCR_STRATEGY: undefined }, () => {
    assert.equal(resolveOcrStrategy(), "single");
  });
  withEnv({ OCR_STRATEGY: "fallback" }, () => {
    assert.equal(resolveOcrStrategy(), "fallback");
  });
  withEnv({ OCR_STRATEGY: "parallel" }, () => {
    assert.equal(resolveOcrStrategy(), "parallel");
  });
  withEnv({ OCR_STRATEGY: "bogus" }, () => {
    assert.throws(() => resolveOcrStrategy(), (e: unknown) => e instanceof OcrConfigError);
  });
});

// ── Orchestrator wiring (no-secondary path) ──────────────────────────────────

test("runExtraction attaches provenance meta and degrades when no secondary exists", async () => {
  const original = {
    OCR_PROVIDER: process.env.OCR_PROVIDER,
    OCR_STRATEGY: process.env.OCR_STRATEGY,
  };
  process.env["OCR_PROVIDER"] = "mock";
  process.env["OCR_STRATEGY"] = "parallel";

  try {
    const result = await extractInvoiceData({ fileName: "receipt.png" });
    assert.ok(result.meta, "expected provenance meta");
    assert.equal(result.meta?.strategy, "parallel");
    // mock has no fallback engine, so it degrades to a single provider cleanly.
    assert.deepEqual(result.meta?.providersUsed, ["mock"]);
    assert.equal(result.meta?.fallbackProvider, null);
    // Core wizard fields remain present and backward-compatible.
    for (const key of ["amount", "confidence", "invoiceDate", "invoiceNumber", "provider"]) {
      assert.ok(key in result, `missing core key: ${key}`);
    }
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
