import { parseInvoiceFieldsFromText } from "../../lib/ocr/ocr-parsing";
import { simulateTemplates } from "../../lib/ocr/templates/simulation";
import { applyTemplate, type ApplicationGate } from "../../lib/ocr/templates/application";
import type { SimulationDecision } from "../../lib/ocr/types";
import type { ReceiptFixture } from "../fixtures/receipts";

// Pure, test-only benchmark harness (NOT a production feature). It runs the real
// parser → static-template simulation → guarded application against an anonymized
// fixture and reports a safety/expectation row. The apply gate is forced OPEN here
// (no env/compose change) so the post-application path is exercised — proving that
// even with apply on, templates never produce a wrong financial value.

const STRONG_PARSER_AMOUNT = 0.85;
const centsEqual = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

// Gate with apply forced on, purely for benchmarking. Production stays off.
export const OPEN_APPLY_GATE: ApplicationGate = {
  mode: "apply",
  apply: true,
  blockedReason: null,
};

export type BenchmarkRow = {
  name: string;
  receiptType: string;
  matchedTemplateId: string | null;
  decision: SimulationDecision;
  expectedAmount: number | null;
  parserAmount: number;
  parserAmountConfidence: number;
  finalAmount: number;
  applied: boolean;
  appliedAmount: boolean;
  appliedDate: boolean;
  safe: boolean;
  pass: boolean;
  issues: string[];
};

export function runFixtureBenchmark(
  fixture: ReceiptFixture,
  gate: ApplicationGate = OPEN_APPLY_GATE,
): BenchmarkRow {
  const parser = parseInvoiceFieldsFromText(fixture.rawText, "paddle", 0.9);
  const simulation = simulateTemplates({
    merchantGuess: parser.merchant || null,
    receiptType: parser.receiptType,
    rawText: fixture.rawText,
    candidates: parser.candidates,
    parser: {
      invoiceNumber: parser.invoiceNumber,
      invoiceDate: parser.invoiceDate,
      amount: parser.amount,
      confidence: parser.confidence,
    },
  });
  const application = applyTemplate({
    parser,
    simulation,
    candidates: parser.candidates,
    gate,
  });
  const finalAmount = application.result.amount;
  const issues: string[] = [];

  // ── Safety (independent of expectations) ────────────────────────────────────
  for (const forbidden of fixture.expect.mustNotEqualAmount ?? []) {
    if (centsEqual(finalAmount, forbidden)) {
      issues.push(`final amount equals forbidden value ${forbidden}`);
    }
  }
  if (parser.confidence.amount >= STRONG_PARSER_AMOUNT && !centsEqual(finalAmount, parser.amount)) {
    issues.push("application changed a strong parser amount");
  }
  const safe = issues.length === 0;

  // ── Expectation checks ──────────────────────────────────────────────────────
  if (!fixture.expect.receiptType.includes(parser.receiptType)) {
    issues.push(`receiptType ${parser.receiptType} not in expected set`);
  }
  if (fixture.expect.amount !== undefined && !centsEqual(finalAmount, fixture.expect.amount)) {
    issues.push(`final amount ${finalAmount} != expected ${fixture.expect.amount}`);
  }
  if (fixture.expect.amount === undefined && finalAmount !== 0) {
    issues.push(`expected blank amount but got ${finalAmount}`);
  }
  if (fixture.expectTemplate) {
    const matched = simulation.matchedTemplateId !== null;
    if (matched !== fixture.expectTemplate.matches) {
      issues.push(`template matched=${matched}, expected ${fixture.expectTemplate.matches}`);
    }
    if (
      fixture.expectTemplate.templateId !== undefined &&
      simulation.matchedTemplateId !== fixture.expectTemplate.templateId
    ) {
      issues.push(
        `template id ${simulation.matchedTemplateId} != expected ${fixture.expectTemplate.templateId}`,
      );
    }
    const expectApplyAmount = fixture.expectTemplate.appliesAmount ?? false;
    if (Boolean(application.appliedFields.amount) !== expectApplyAmount) {
      issues.push(`appliedAmount=${Boolean(application.appliedFields.amount)}, expected ${expectApplyAmount}`);
    }
    const expectApplyDate = fixture.expectTemplate.appliesDate ?? false;
    if (Boolean(application.appliedFields.date) !== expectApplyDate) {
      issues.push(`appliedDate=${Boolean(application.appliedFields.date)}, expected ${expectApplyDate}`);
    }
  }

  return {
    name: fixture.name,
    receiptType: parser.receiptType,
    matchedTemplateId: simulation.matchedTemplateId,
    decision: simulation.decision,
    expectedAmount: fixture.expect.amount ?? null,
    parserAmount: parser.amount,
    parserAmountConfidence: parser.confidence.amount,
    finalAmount,
    applied: application.applied,
    appliedAmount: Boolean(application.appliedFields.amount),
    appliedDate: Boolean(application.appliedFields.date),
    safe,
    pass: issues.length === 0,
    issues,
  };
}

export function runBenchmarkMatrix(
  fixtures: readonly ReceiptFixture[],
  gate: ApplicationGate = OPEN_APPLY_GATE,
): BenchmarkRow[] {
  return fixtures.map((fixture) => runFixtureBenchmark(fixture, gate));
}

/** One-line, value-safe summary of a row (amounts/labels only, no receipt text). */
export function formatBenchmarkRow(row: BenchmarkRow): string {
  const status = row.pass ? "PASS" : "FAIL";
  const tpl = row.matchedTemplateId ?? "—";
  return (
    `[${status}] ${row.name.padEnd(20)} type=${row.receiptType.padEnd(15)} ` +
    `tpl=${tpl.padEnd(20)} decision=${row.decision.padEnd(15)} ` +
    `parser=${row.parserAmount}(${row.parserAmountConfidence}) final=${row.finalAmount} ` +
    `applied=${row.applied}` +
    (row.issues.length ? ` issues=${row.issues.join("; ")}` : "")
  );
}
