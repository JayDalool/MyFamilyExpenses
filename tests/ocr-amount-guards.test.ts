import assert from "node:assert/strict";
import test from "node:test";
import { parseInvoiceFieldsFromText } from "../lib/ocr/ocr-parsing";

// Phase 2 — amount ranking guards + generated-invoice ticket detection.
// All fixtures are synthetic/anonymized; they mirror the *structure* of the
// production "Danali" miss without embedding raw receipt data.

const DANALI_PATTERN = [
  "Example Auto Shop",
  "Ticket: TK100234",
  "19/06/2026 2:32 pm",
  "Fee total $0.00",
  "Subtotal $129.00",
  "GST $6.45",
  "PST $9.03",
  "Total Tax $15.48",
  "Total $144.48",
  "Credit Card $144.48",
  "Sale $144.48",
].join("\n");

test("Danali-style receipt: chooses 144.48 as the total, never 0.00", () => {
  const result = parseInvoiceFieldsFromText(DANALI_PATTERN, "paddle", 0.9);

  assert.equal(result.amount, 144.48);
  assert.notEqual(result.amount, 0);
  assert.ok(result.confidence.amount > 0.7, "expected a confident total");

  // None of the non-payable lines may ever be selected.
  for (const forbidden of [0, 129.0, 6.45, 9.03, 15.48]) {
    assert.notEqual(result.amount, forbidden, `amount must not equal ${forbidden}`);
  }
});

test("Danali-style receipt: reads the ticket number as the invoice reference", () => {
  const result = parseInvoiceFieldsFromText(DANALI_PATTERN, "paddle", 0.9);

  assert.equal(result.invoiceNumber, "TK100234");
  assert.ok(result.confidence.invoiceNumber > 0, "ticket number should be confident");
});

test("Danali-style receipt: day-first date 19/06/2026 parses to 2026-06-19", () => {
  const result = parseInvoiceFieldsFromText(DANALI_PATTERN, "paddle", 0.9);
  assert.equal(result.invoiceDate, "2026-06-19");
});

// ── Amount avoidance guards (each non-payable label is never picked) ─────────

function parseAmount(lines: string[]): number {
  return parseInvoiceFieldsFromText(lines.join("\n"), "paddle", 0.9).amount;
}

test("a $0.00 fee line never wins over a real non-zero total", () => {
  assert.equal(
    parseAmount(["Store", "Fee total $0.00", "Total $52.10", "2024-01-02"]),
    52.1,
  );
});

test("subtotal / tax / change / cash back / balance / tendered are not chosen", () => {
  assert.equal(
    parseAmount(["Shop", "Subtotal 40.00", "Tax 5.00", "Total 45.00", "2024-01-02"]),
    45.0,
  );
  assert.equal(
    parseAmount(["Shop", "Total 20.00", "Cash 25.00", "Change 5.00", "2024-01-02"]),
    20.0,
  );
  assert.equal(
    parseAmount([
      "Shop",
      "Total 30.00",
      "Debit 30.00",
      "Cash Back 40.00",
      "2024-01-02",
    ]),
    30.0,
  );
  assert.equal(
    parseAmount(["Shop", "Total 12.00", "Amount tendered 20.00", "2024-01-02"]),
    12.0,
  );
});

test("an explicit zero total is only picked when no non-zero candidate exists", () => {
  // Genuine zero-balance slip: no other plausible amount → an explicit Total 0.00
  // may be surfaced (low stakes; user reviews).
  const zeroOnly = parseInvoiceFieldsFromText(
    ["Statement", "Total $0.00", "2024-01-02"].join("\n"),
    "paddle",
    0.9,
  );
  assert.equal(zeroOnly.amount, 0);

  // But as soon as a non-zero amount is present, zero must never win.
  assert.equal(
    parseAmount(["Statement", "Total $0.00", "Amount Due $18.75", "2024-01-02"]),
    18.75,
  );
});
