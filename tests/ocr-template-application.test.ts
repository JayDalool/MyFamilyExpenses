import assert from "node:assert/strict";
import test from "node:test";
import type {
  OcrCandidates,
  OcrResult,
  TemplateSimulationResult,
} from "../lib/ocr/types";
import {
  applyTemplate,
  resolveApplicationGate,
  type ApplicationGate,
} from "../lib/ocr/templates/application";
import { simulateTemplates } from "../lib/ocr/templates/simulation";

function parser(over: Partial<OcrResult> = {}): OcrResult {
  return {
    invoiceNumber: "",
    invoiceDate: "2024-03-14",
    amount: 0,
    provider: "paddle",
    confidence: { invoiceNumber: 0, invoiceDate: 0.8, amount: 0 },
    receiptType: "retail",
    multipleReceipts: false,
    warnings: [],
    candidates: { invoiceNumber: [], invoiceDate: [], amount: [], merchant: [] },
    merchant: "CASH RECEIPT",
    ...over,
  };
}

function sim(over: Partial<TemplateSimulationResult> = {}): TemplateSimulationResult {
  return {
    matchedTemplateId: "generic-cash-receipt",
    templateName: "generic-cash-receipt",
    suggestedAmount: null,
    suggestedAmountConfidence: null,
    suggestedDate: null,
    suggestedInvoice: null,
    confidenceDelta: 0,
    warnings: [],
    decision: "same_as_parser",
    reasons: [],
    ...over,
  };
}

const APPLY_GATE: ApplicationGate = { mode: "apply", apply: true, blockedReason: null };
const SIMULATE_GATE: ApplicationGate = { mode: "simulate", apply: false, blockedReason: null };
const noCandidates = (): OcrCandidates => ({
  invoiceNumber: [],
  invoiceDate: [],
  amount: [],
  merchant: [],
});

// ── Gate semantics ───────────────────────────────────────────────────────────

test("gate: apply blocked unless mode=apply and production second-guard set", () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = { mode: env.OCR_TEMPLATE_MODE, prod: env.OCR_TEMPLATE_APPLY_IN_PRODUCTION, node: env.NODE_ENV };
  try {
    env.OCR_TEMPLATE_MODE = "simulate";
    env.NODE_ENV = "development";
    assert.equal(resolveApplicationGate().apply, false);

    env.OCR_TEMPLATE_MODE = "apply";
    env.NODE_ENV = "development";
    assert.equal(resolveApplicationGate().apply, true);

    env.NODE_ENV = "production";
    delete env.OCR_TEMPLATE_APPLY_IN_PRODUCTION;
    const blocked = resolveApplicationGate();
    assert.equal(blocked.apply, false);
    assert.match(blocked.blockedReason ?? "", /production/i);

    env.OCR_TEMPLATE_APPLY_IN_PRODUCTION = "true";
    assert.equal(resolveApplicationGate().apply, true);
  } finally {
    for (const [k, v] of [
      ["OCR_TEMPLATE_MODE", saved.mode],
      ["OCR_TEMPLATE_APPLY_IN_PRODUCTION", saved.prod],
      ["NODE_ENV", saved.node],
    ] as const) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  }
});

test("no application when the gate is closed (simulate mode)", () => {
  const p = parser({ amount: 0, confidence: { invoiceNumber: 0, invoiceDate: 0.8, amount: 0 } });
  const result = applyTemplate({
    parser: p,
    simulation: sim({ decision: "would_improve", suggestedAmount: 8, suggestedAmountConfidence: 0.9 }),
    candidates: noCandidates(),
    gate: SIMULATE_GATE,
  });
  assert.equal(result.applied, false);
  assert.strictEqual(result.result, p); // unchanged, same reference
});

// ── Amount safety ────────────────────────────────────────────────────────────

test("strong parser amount is never overridden (unsafe)", () => {
  const p = parser({ amount: 50, confidence: { invoiceNumber: 0, invoiceDate: 0.8, amount: 0.9 } });
  const result = applyTemplate({
    parser: p,
    simulation: sim({ decision: "unsafe", suggestedAmount: 8, suggestedAmountConfidence: 0.9 }),
    candidates: noCandidates(),
    gate: APPLY_GATE,
  });
  assert.equal(result.applied, false);
  assert.equal(result.result.amount, 50);
  assert.strictEqual(result.result, p);
});

test("would_conflict keeps the parser amount", () => {
  const p = parser({ amount: 50, confidence: { invoiceNumber: 0, invoiceDate: 0.8, amount: 0.7 } });
  const result = applyTemplate({
    parser: p,
    simulation: sim({ decision: "would_conflict", suggestedAmount: 8, suggestedAmountConfidence: 0.9 }),
    candidates: noCandidates(),
    gate: APPLY_GATE,
  });
  assert.equal(result.applied, false);
  assert.equal(result.result.amount, 50);
});

test("weak/missing parser amount is filled from a high-confidence template total", () => {
  const p = parser({ amount: 0, confidence: { invoiceNumber: 0, invoiceDate: 0.8, amount: 0 } });
  const result = applyTemplate({
    parser: p,
    simulation: sim({ decision: "would_improve", suggestedAmount: 8, suggestedAmountConfidence: 0.85 }),
    candidates: noCandidates(),
    gate: APPLY_GATE,
  });
  assert.equal(result.applied, true);
  assert.equal(result.appliedFields.amount, true);
  assert.equal(result.result.amount, 8);
  assert.equal(result.result.confidence.amount, 0.85);
  assert.equal(result.appliedTemplateId, "generic-cash-receipt");
  // Original object is not mutated.
  assert.equal(p.amount, 0);
});

test("low-confidence template amount is NOT applied", () => {
  const p = parser({ amount: 0, confidence: { invoiceNumber: 0, invoiceDate: 0.8, amount: 0 } });
  const result = applyTemplate({
    parser: p,
    simulation: sim({ decision: "would_improve", suggestedAmount: 8, suggestedAmountConfidence: 0.5 }),
    candidates: noCandidates(),
    gate: APPLY_GATE,
  });
  assert.equal(result.applied, false);
  assert.strictEqual(result.result, p);
});

test("subtotal/tax/change labels are never applied (simulation + application)", () => {
  const candidates: OcrCandidates = {
    invoiceNumber: [],
    invoiceDate: [],
    amount: [
      { value: 50, confidence: 0.95, sourceLabel: "Subtotal", reason: "", source: "paddle" },
      { value: 2, confidence: 0.9, sourceLabel: "Change", reason: "", source: "paddle" },
      { value: 3, confidence: 0.9, sourceLabel: "Tax", reason: "", source: "paddle" },
    ],
    merchant: [],
  };
  const simulation = simulateTemplates({
    merchantGuess: "CASH RECEIPT",
    receiptType: "retail",
    candidates,
    parser: { invoiceNumber: "", invoiceDate: "2024-03-14", amount: 0, confidence: { invoiceNumber: 0, invoiceDate: 0.8, amount: 0 } },
  });
  const result = applyTemplate({
    parser: parser({ candidates }),
    simulation,
    candidates,
    gate: APPLY_GATE,
  });
  assert.equal(result.applied, false);
  assert.equal(result.result.amount, 0);
});

// ── Date / invoice ───────────────────────────────────────────────────────────

test("missing date is filled only from a high-confidence candidate", () => {
  const candidates: OcrCandidates = {
    invoiceNumber: [],
    invoiceDate: [{ value: "2024-03-14", confidence: 0.85, sourceLabel: "Date", reason: "", source: "paddle" }],
    amount: [],
    merchant: [],
  };
  const filled = applyTemplate({
    parser: parser({ invoiceDate: "", confidence: { invoiceNumber: 0, invoiceDate: 0, amount: 0 } }),
    simulation: sim(),
    candidates,
    gate: APPLY_GATE,
  });
  assert.equal(filled.appliedFields.date, true);
  assert.equal(filled.result.invoiceDate, "2024-03-14");

  const lowConf: OcrCandidates = {
    ...candidates,
    invoiceDate: [{ value: "2024-03-14", confidence: 0.5, sourceLabel: "Date", reason: "", source: "paddle" }],
  };
  const notFilled = applyTemplate({
    parser: parser({ invoiceDate: "", confidence: { invoiceNumber: 0, invoiceDate: 0, amount: 0 } }),
    simulation: sim(),
    candidates: lowConf,
    gate: APPLY_GATE,
  });
  assert.notEqual(notFilled.appliedFields.date, true);
});

test("a present parser date is never overwritten", () => {
  const candidates: OcrCandidates = {
    invoiceNumber: [],
    invoiceDate: [{ value: "1999-01-01", confidence: 0.99, sourceLabel: "Date", reason: "", source: "paddle" }],
    amount: [],
    merchant: [],
  };
  const result = applyTemplate({
    parser: parser({ invoiceDate: "2024-03-14", confidence: { invoiceNumber: 0, invoiceDate: 0.8, amount: 0 } }),
    simulation: sim(),
    candidates,
    gate: APPLY_GATE,
  });
  assert.notEqual(result.appliedFields.date, true);
  assert.equal(result.result.invoiceDate, "2024-03-14");
});

test("invoice/reference is never forced", () => {
  const result = applyTemplate({
    parser: parser({ invoiceNumber: "" }),
    simulation: sim({ decision: "would_improve", suggestedAmount: 8, suggestedAmountConfidence: 0.9 }),
    candidates: noCandidates(),
    gate: APPLY_GATE,
  });
  assert.notEqual(result.appliedFields.invoice, true);
  assert.equal(result.result.invoiceNumber, "");
});

// ── Privacy ──────────────────────────────────────────────────────────────────

test("application metadata carries no raw text, blocks, or card digits", () => {
  const result = applyTemplate({
    parser: parser({ amount: 0, confidence: { invoiceNumber: 0, invoiceDate: 0.8, amount: 0 } }),
    simulation: sim({ decision: "would_improve", suggestedAmount: 8, suggestedAmountConfidence: 0.9 }),
    candidates: noCandidates(),
    gate: APPLY_GATE,
  });
  const { result: _omitResult, ...meta } = result;
  void _omitResult;
  const json = JSON.stringify(meta);
  assert.doesNotMatch(json, /rawText|blocks/);
  assert.doesNotMatch(json, /\d{7,}/);
});
