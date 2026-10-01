import assert from "node:assert/strict";
import test from "node:test";
import { RECEIPT_FIXTURES } from "./fixtures/receipts";
import {
  formatBenchmarkRow,
  runBenchmarkMatrix,
  runFixtureBenchmark,
} from "./helpers/ocr-template-benchmark";
import { selectTemplate, type SimulationInput } from "../lib/ocr/templates/simulation";
import { MERCHANT_TEMPLATES } from "../lib/ocr/templates/merchant-templates";
import type { MerchantTemplate } from "../lib/ocr/templates/types";
import type { OcrCandidates } from "../lib/ocr/types";

// ── Benchmark matrix ─────────────────────────────────────────────────────────

test("benchmark matrix: every fixture is safe and meets expectations (apply gate open)", () => {
  const rows = runBenchmarkMatrix(RECEIPT_FIXTURES);
  // Print the pass/fail matrix for visibility (test output only).
  for (const row of rows) console.log(formatBenchmarkRow(row));

  const failures = rows.filter((r) => !r.pass);
  assert.deepEqual(
    failures.map((r) => `${r.name}: ${r.issues.join("; ")}`),
    [],
  );
  // Sanity: every row is safe (no forbidden amount, no strong-amount override).
  assert.ok(rows.every((r) => r.safe));
});

test("benchmark: no fixture triggers an amount application (parser already confident)", () => {
  // The conservative invariant for the current library: on clean real-world
  // receipts the parser is already confident, so guarded application FILLS nothing.
  // (The fill path itself is covered by ocr-template-application.test.ts.)
  const rows = runBenchmarkMatrix(RECEIPT_FIXTURES);
  assert.ok(rows.every((r) => r.appliedAmount === false));
});

test("benchmark: balance-only receipt keeps a blank amount", () => {
  const row = runFixtureBenchmark(RECEIPT_FIXTURES.find((f) => f.name === "balance-only")!);
  assert.equal(row.finalAmount, 0);
  assert.equal(row.pass, true);
});

// ── Template priority + false-positive prevention ────────────────────────────

function tpl(over: Partial<MerchantTemplate> & Pick<MerchantTemplate, "id">): MerchantTemplate {
  return {
    merchantPattern: /shop/i,
    receiptType: "any",
    amountRules: {},
    dateRules: {},
    invoiceRules: {},
    ...over,
  };
}

function simInput(over: Partial<SimulationInput> = {}): SimulationInput {
  const candidates: OcrCandidates = { invoiceNumber: [], invoiceDate: [], amount: [], merchant: [] };
  return {
    merchantGuess: "Example Shop",
    receiptType: "retail",
    candidates,
    parser: { invoiceNumber: "", invoiceDate: "", amount: 0, confidence: { invoiceNumber: 0, invoiceDate: 0, amount: 0 } },
    ...over,
  };
}

test("selectTemplate: higher priority wins regardless of registry order", () => {
  const generic = tpl({ id: "generic", priority: 0 });
  const specific = tpl({ id: "specific", priority: 10 });
  assert.equal(selectTemplate([generic, specific], simInput())?.id, "specific");
  assert.equal(selectTemplate([specific, generic], simInput())?.id, "specific");
});

test("selectTemplate: negativePatterns prevent a false-positive match", () => {
  const t = tpl({ id: "cashy", merchantPattern: /cash/i, negativePatterns: ["invoice"] });
  assert.equal(selectTemplate([t], simInput({ merchantGuess: "cash invoice" }))?.id ?? null, null);
  assert.equal(selectTemplate([t], simInput({ merchantGuess: "cash sale" }))?.id, "cashy");
});

test("selectTemplate: receipt-type gating prevents cross-type matches", () => {
  const bankOnly = tpl({ id: "bank", receiptType: "bank_withdrawal", merchantPattern: /atm/i });
  assert.equal(selectTemplate([bankOnly], simInput({ merchantGuess: "ATM", receiptType: "retail" })), null);
  assert.equal(
    selectTemplate([bankOnly], simInput({ merchantGuess: "ATM", receiptType: "bank_withdrawal" }))?.id,
    "bank",
  );
});

// ── Privacy ──────────────────────────────────────────────────────────────────

test("fixtures contain no full card numbers or long account runs", () => {
  for (const fixture of RECEIPT_FIXTURES) {
    assert.doesNotMatch(fixture.rawText, /\b(?:\d[ -]?){13,19}\b/, `${fixture.name} has a card-like number`);
    assert.doesNotMatch(fixture.rawText, /\d{7,}/, `${fixture.name} has a long digit run`);
  }
});

test("benchmark rows expose no raw OCR text, blocks, or long digit runs", () => {
  const json = JSON.stringify(runBenchmarkMatrix(RECEIPT_FIXTURES));
  assert.doesNotMatch(json, /rawText|blocks/);
  assert.doesNotMatch(json, /\d{7,}/);
});

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
