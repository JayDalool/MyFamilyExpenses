import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// MFE-016 (ADR 0003): loading docker-compose.ocr.yml must not switch the live
// OCR engine, and the app must start without a healthy sidecar. Plain text
// checks, because the repo has no YAML parser dependency.
const compose = readFileSync("docker-compose.ocr.yml", "utf8");
const code = compose
  .split("\n")
  .filter((line) => !line.trim().startsWith("#"))
  .join("\n");

test("override defaults stay tesseract/single", () => {
  assert.match(code, /OCR_PROVIDER: \$\{OCR_PROVIDER:-tesseract\}/);
  assert.match(code, /OCR_STRATEGY: \$\{OCR_STRATEGY:-single\}/);
  assert.doesNotMatch(code, /:-paddle\}/);
  assert.doesNotMatch(code, /OCR_STRATEGY:-fallback/);
});

test("app does not wait for the sidecar to be healthy", () => {
  assert.doesNotMatch(code, /depends_on/);
  assert.doesNotMatch(code, /service_healthy/);
});

test("sidecar stays internal-only with no published port", () => {
  assert.doesNotMatch(code, /^\s*ports:/m);
  assert.match(code, /internal: true/);
});
