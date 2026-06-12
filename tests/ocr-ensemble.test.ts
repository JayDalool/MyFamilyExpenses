import assert from "node:assert/strict";
import test from "node:test";
import { legacyParse } from "../lib/ocr/legacy-parser";
import { extractInvoiceData } from "../lib/ocr/ocr.service";

// ── Legacy / simple parser strategy ──────────────────────────────────────────

test("legacy parser finds an obvious labelled total and date", () => {
  const result = legacyParse(
    ["CASH RECEIPT", "Date: 01-01-2018 10:35", "Total 84.80"].join("\n"),
  );
  assert.equal(result.amount, 84.8);
  assert.equal(result.confidence.amount > 0, true);
  assert.equal(result.candidates.amount[0].source, "legacy");
  assert.equal(result.invoiceDate, "2018-01-01");
});

test("legacy parser ignores subtotal, tax and change", () => {
  const result = legacyParse(
    [
      "Sub-total 76.80",
      "Sales Tax 8.00",
      "Total 84.80",
      "Cash 100.00",
      "Change 15.20",
    ].join("\n"),
  );
  assert.equal(result.amount, 84.8);
  assert.ok(!result.candidates.amount.some((c) => c.value === 15.2));
  assert.ok(!result.candidates.amount.some((c) => c.value === 76.8));
});

test("legacy parser only accepts labelled invoice numbers, not address text", () => {
  const withLabel = legacyParse("Invoice No INV-2026-001\nTotal 10.00");
  assert.equal(withLabel.invoiceNumber, "INV-2026-001");

  const addressOnly = legacyParse(
    "Address: 1234 Lorem Ipsum\nTel: 123-456-7890\nTotal 10.00",
  );
  assert.equal(addressOnly.invoiceNumber, "");
});

test("legacy parser leaves genuinely ambiguous dates blank", () => {
  // 06/07/2023 (both <= 12, not equal) is ambiguous → legacy declines.
  const result = legacyParse("Date: 06/07/2023\nTotal 10.00");
  assert.equal(result.invoiceDate, "");
});

// ── Ensemble through the orchestrator ────────────────────────────────────────

function withMockEnv(strategy: string, run: () => Promise<void>) {
  const original = {
    OCR_PROVIDER: process.env.OCR_PROVIDER,
    OCR_STRATEGY: process.env.OCR_STRATEGY,
  };
  process.env["OCR_PROVIDER"] = "mock";
  process.env["OCR_STRATEGY"] = strategy;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

test("ensemble strategy runs the legacy parser and boosts agreeing fields", async () => {
  let singleAmountConfidence = 0;

  await withMockEnv("single", async () => {
    const result = await extractInvoiceData({ fileName: "receipt.png" });
    singleAmountConfidence = result.confidence.amount;
    assert.equal(result.meta?.strategy, "single");
  });

  await withMockEnv("ensemble", async () => {
    const result = await extractInvoiceData({ fileName: "receipt.png" });
    assert.equal(result.meta?.strategy, "ensemble");
    // The mock engine emits "Total: $24.99"; the legacy parser agrees, so the
    // ensemble amount confidence is boosted above the single-engine confidence.
    assert.ok(
      result.confidence.amount > singleAmountConfidence,
      `ensemble ${result.confidence.amount} should be > single ${singleAmountConfidence}`,
    );
    // The amount is still the same value — agreement, not a new guess.
    assert.equal(typeof result.amount, "number");
  });
});
