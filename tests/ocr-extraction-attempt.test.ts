import assert from "node:assert/strict";
import test from "node:test";
import {
  computeFileSha256,
  redactSensitiveText,
  EXTRACTION_ATTEMPT_TTL_MINUTES,
} from "../lib/ocr/extraction-attempt";

// ── File fingerprint ─────────────────────────────────────────────────────────

test("computeFileSha256 is a deterministic hex sha256", () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const a = computeFileSha256(bytes);
  const b = computeFileSha256(new Uint8Array([1, 2, 3, 4]));
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  // Different bytes → different hash.
  assert.notEqual(a, computeFileSha256(new Uint8Array([1, 2, 3, 5])));
});

// ── Redaction (card/account/phone) ───────────────────────────────────────────

test("redaction masks card numbers", () => {
  assert.match(redactSensitiveText("Card 4111 1111 1111 1111"), /\[REDACTED\]/);
  assert.doesNotMatch(redactSensitiveText("Card 4111 1111 1111 1111"), /4111/);
  assert.match(redactSensitiveText("VISA 4111-1111-1111-1111"), /\[REDACTED\]/);
  assert.match(redactSensitiveText("Card ****1234"), /\[REDACTED\]/);
});

test("redaction masks long account numbers and phone numbers", () => {
  assert.match(redactSensitiveText("Account No 1234567890123"), /\[REDACTED\]/);
  assert.doesNotMatch(redactSensitiveText("Account No 1234567890123"), /1234567890123/);
  assert.match(redactSensitiveText("Tel: 123-456-7890"), /\[REDACTED\]/);
});

test("redaction keeps dates, amounts and short invoice numbers intact", () => {
  const text = "Date 2018-01-01\nTotal 84.80\nInvoice No INV-2026-001\nReceipt 004615-312-001";
  const redacted = redactSensitiveText(text);
  assert.match(redacted, /2018-01-01/);
  assert.match(redacted, /84\.80/);
  assert.match(redacted, /INV-2026-001/);
  assert.match(redacted, /004615-312-001/);
  assert.doesNotMatch(redacted, /\[REDACTED\]/);
});

test("the attempt TTL is short-lived", () => {
  assert.ok(EXTRACTION_ATTEMPT_TTL_MINUTES > 0);
  assert.ok(EXTRACTION_ATTEMPT_TTL_MINUTES <= 120);
});
