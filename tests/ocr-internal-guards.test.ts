import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

// Weak check (the real confirmation is a manual nav inspection): the internal
// OCR diagnostics page must not be linked from the shared app navigation.
test("OCR learning is not linked from the primary navigation", () => {
  const shell = read("components/app-shell.tsx");
  assert.doesNotMatch(shell, /href="\/ocr-learning"/);
});

// The live OCR parser/service must never import the learning/template workflow.
// This import-absence IS the guarantee that feedback data cannot change parsing
// automatically.
test("live parser modules do not import the template/learning workflow", () => {
  for (const file of ["lib/ocr/ocr-parsing.ts", "lib/ocr/ocr.service.ts"]) {
    const source = read(file);
    assert.doesNotMatch(source, /ocr\/templates/, `${file} must not import templates`);
    assert.doesNotMatch(source, /learning-insights/, `${file} must not import learning-insights`);
    assert.doesNotMatch(source, /correction-feedback/, `${file} must not import correction-feedback`);
  }
});

// The template/draft workflow must not import the live parser/engine either, so it
// cannot reach into or mutate parsing.
test("template draft workflow does not import the live parser or engines", () => {
  for (const file of [
    "lib/ocr/templates/drafts.ts",
    "lib/ocr/templates/recommendations.ts",
    "lib/ocr/templates/merchant-templates.ts",
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /ocr-parsing/, `${file} must not import the parser`);
    assert.doesNotMatch(source, /ocr\.service/, `${file} must not import the OCR service`);
  }
});
