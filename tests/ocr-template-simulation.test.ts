import assert from "node:assert/strict";
import test from "node:test";
import type { OcrAmountCandidate, OcrCandidates } from "../lib/ocr/types";
import {
  resolveTemplateMode,
  simulateTemplates,
  type SimulationInput,
} from "../lib/ocr/templates/simulation";
import { MERCHANT_TEMPLATES } from "../lib/ocr/templates/merchant-templates";
import { runExtraction } from "../lib/ocr/ocr.service";

function amountCandidate(
  value: number,
  sourceLabel: string,
  confidence: number,
): OcrAmountCandidate {
  return { value, confidence, sourceLabel, reason: "test", source: "paddle" };
}

function candidates(amount: OcrAmountCandidate[]): OcrCandidates {
  return { invoiceNumber: [], invoiceDate: [], amount, merchant: [] };
}

function input(over: Partial<SimulationInput> = {}): SimulationInput {
  return {
    merchantGuess: "CASH RECEIPT",
    receiptType: "retail",
    candidates: candidates([amountCandidate(8.0, "Total", 0.8)]),
    parser: {
      invoiceNumber: "",
      invoiceDate: "2024-03-14",
      amount: 8.0,
      confidence: { invoiceNumber: 0, invoiceDate: 0.8, amount: 0.8 },
    },
    ...over,
  };
}

// ── Matching ─────────────────────────────────────────────────────────────────

test("matches the generic cash receipt static template", () => {
  const result = simulateTemplates(input());
  assert.equal(result.matchedTemplateId, "generic-cash-receipt");
});

test("no match for an unrelated merchant/receipt type", () => {
  const result = simulateTemplates(
    input({ merchantGuess: "Starbucks", receiptType: "restaurant", rawText: "Starbucks latte" }),
  );
  assert.equal(result.decision, "no_match");
  assert.equal(result.matchedTemplateId, null);
});

// ── Decision tree (synthetic confidences) ────────────────────────────────────

test("same_as_parser when the preferred candidate equals the parser amount", () => {
  const result = simulateTemplates(input()); // Total 8.00 == parser 8.00
  assert.equal(result.decision, "same_as_parser");
  assert.equal(result.suggestedAmount, null);
});

test("would_improve when parser amount is weak and template prefers a different total", () => {
  const result = simulateTemplates(
    input({
      candidates: candidates([
        amountCandidate(8.0, "Total", 0.7),
        amountCandidate(10.0, "Cash", 0.5),
      ]),
      parser: {
        invoiceNumber: "",
        invoiceDate: "2024-03-14",
        amount: 10.0,
        confidence: { invoiceNumber: 0, invoiceDate: 0.8, amount: 0.4 },
      },
    }),
  );
  assert.equal(result.decision, "would_improve");
  assert.equal(result.suggestedAmount, 8.0);
});

test("would_conflict when the parser amount is moderately confident", () => {
  const result = simulateTemplates(
    input({
      candidates: candidates([amountCandidate(8.0, "Total", 0.7)]),
      parser: {
        invoiceNumber: "",
        invoiceDate: "2024-03-14",
        amount: 10.0,
        confidence: { invoiceNumber: 0, invoiceDate: 0.8, amount: 0.7 },
      },
    }),
  );
  assert.equal(result.decision, "would_conflict");
});

test("unsafe when the template would override a strong parser total", () => {
  const result = simulateTemplates(
    input({
      candidates: candidates([amountCandidate(8.0, "Total", 0.7)]),
      parser: {
        invoiceNumber: "",
        invoiceDate: "2024-03-14",
        amount: 10.0,
        confidence: { invoiceNumber: 0, invoiceDate: 0.8, amount: 0.9 },
      },
    }),
  );
  assert.equal(result.decision, "unsafe");
  assert.ok(result.warnings.some((w) => /override/i.test(w)));
});

// ── Avoided labels ───────────────────────────────────────────────────────────

test("avoided labels (subtotal/tax/change) are never selected", () => {
  const result = simulateTemplates(
    input({
      candidates: candidates([
        amountCandidate(50.0, "Subtotal", 0.95),
        amountCandidate(2.0, "Change", 0.9),
        amountCandidate(3.0, "Tax", 0.9),
      ]),
      parser: {
        invoiceNumber: "",
        invoiceDate: "2024-03-14",
        amount: 55.0,
        confidence: { invoiceNumber: 0, invoiceDate: 0.8, amount: 0.5 },
      },
    }),
  );
  // No preferred (total/amount due/cash) candidate exists, only avoided ones.
  assert.equal(result.suggestedAmount, null);
  assert.equal(result.decision, "same_as_parser");
  assert.doesNotMatch(JSON.stringify(result), /\b(50|2|3)\b/);
});

// ── Invoice optional ─────────────────────────────────────────────────────────

test("invoice-optional template notes optional/generated when parser invoice is empty", () => {
  const result = simulateTemplates(input({ parser: { invoiceNumber: "", invoiceDate: "2024-03-14", amount: 8.0, confidence: { invoiceNumber: 0, invoiceDate: 0.8, amount: 0.8 } } }));
  assert.ok(result.reasons.some((r) => /optional/i.test(r)));
  assert.equal(result.suggestedInvoice, null);
});

// ── Privacy ──────────────────────────────────────────────────────────────────

test("simulation never returns raw OCR text or card digits", () => {
  const result = simulateTemplates(
    input({ rawText: "CASH RECEIPT\nCard 4111 1111 1111 1111\nTotal 8.00" }),
  );
  const json = JSON.stringify(result);
  assert.doesNotMatch(json, /4111/);
  assert.doesNotMatch(json, /rawText/);
  assert.ok(!("rawText" in result));
});

// ── Static template hygiene ──────────────────────────────────────────────────

test("static templates contain no card/account/long-digit patterns", () => {
  for (const t of MERCHANT_TEMPLATES) {
    const strings = [
      t.id,
      t.merchantPattern.source,
      t.notes ?? "",
      ...(t.amountRules.preferLabels ?? []),
      ...(t.amountRules.avoidLabels ?? []),
      ...(t.dateRules.preferFormats ?? []),
      ...(t.invoiceRules.labelAliases ?? []),
      ...(t.negativePatterns ?? []),
    ].join(" ");
    assert.doesNotMatch(strings, /\d{7,}/, `${t.id} has a long digit run`);
    assert.doesNotMatch(strings, /\b(?:\d[ -]?){13,19}\b/, `${t.id} has a card-like number`);
  }
});

// ── Environment flag ─────────────────────────────────────────────────────────

test("resolveTemplateMode defaults and clamps safely", () => {
  // NODE_ENV is typed read-only; cast for the test toggles.
  const env = process.env as Record<string, string | undefined>;
  const savedMode = env.OCR_TEMPLATE_MODE;
  const savedEnv = env.NODE_ENV;
  try {
    delete env.OCR_TEMPLATE_MODE;
    env.NODE_ENV = "development";
    assert.equal(resolveTemplateMode(), "simulate");
    env.NODE_ENV = "production";
    assert.equal(resolveTemplateMode(), "off");
    // D.3B: the literal mode is returned (no prod clamp here); the application gate
    // — not resolveTemplateMode — is what blocks apply in production.
    env.OCR_TEMPLATE_MODE = "apply";
    assert.equal(resolveTemplateMode(), "apply");
    env.NODE_ENV = "development";
    assert.equal(resolveTemplateMode(), "apply");
    env.OCR_TEMPLATE_MODE = "off";
    assert.equal(resolveTemplateMode(), "off");
  } finally {
    if (savedMode === undefined) delete env.OCR_TEMPLATE_MODE;
    else env.OCR_TEMPLATE_MODE = savedMode;
    if (savedEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = savedEnv;
  }
});

// ── Apply mode leaves output unchanged when no static template matches ────────

test("apply mode does not change extraction output when no template matches", async () => {
  const saved = {
    mode: process.env.OCR_TEMPLATE_MODE,
    provider: process.env.OCR_PROVIDER,
    strategy: process.env.OCR_STRATEGY,
  };
  try {
    process.env.OCR_PROVIDER = "mock";
    delete process.env.OCR_STRATEGY;
    process.env.OCR_TEMPLATE_MODE = "apply";

    const applied = await runExtraction({ fileName: "r.png" });

    // The mock receipt does not match the cash-receipt template, so nothing is
    // applied: the response is the parser result object ITSELF (by reference).
    assert.strictEqual(applied.response, applied.parserResult);
    // Simulation + application metadata are attached (diagnostic), but application
    // did not change anything.
    assert.notEqual(applied.simulation, undefined);
    assert.equal(applied.application?.applied, false);
  } finally {
    if (saved.mode === undefined) delete process.env.OCR_TEMPLATE_MODE;
    else process.env.OCR_TEMPLATE_MODE = saved.mode;
    if (saved.provider === undefined) delete process.env.OCR_PROVIDER;
    else process.env.OCR_PROVIDER = saved.provider;
    if (saved.strategy === undefined) delete process.env.OCR_STRATEGY;
    else process.env.OCR_STRATEGY = saved.strategy;
  }
});
