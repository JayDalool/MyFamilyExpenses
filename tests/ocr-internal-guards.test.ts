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

// The live OCR path may use ONLY code-reviewed static templates + the dry-run
// simulation. It must never import database-derived drafts/recommendations, the
// learning/feedback modules, or the templates barrel (which re-exports drafts).
// This import-absence IS the guarantee that DB feedback cannot change parsing.
const FORBIDDEN_IN_LIVE_PATH: Array<[RegExp, string]> = [
  [/templates\/drafts/, "templates/drafts"],
  [/templates\/recommendations/, "templates/recommendations"],
  [/from\s+["']@\/lib\/ocr\/templates["']/, "the templates barrel (re-exports drafts)"],
  [/learning-insights/, "learning-insights"],
  [/correction-feedback/, "correction-feedback"],
];

test("ocr-parsing imports nothing from the templates/learning workflow", () => {
  const source = read("lib/ocr/ocr-parsing.ts");
  assert.doesNotMatch(source, /ocr\/templates/, "ocr-parsing must not import any template module");
  assert.doesNotMatch(source, /learning-insights/);
  assert.doesNotMatch(source, /correction-feedback/);
});

test("ocr.service, simulation, and application do not import drafts/recommendations/feedback/barrel", () => {
  for (const file of [
    "lib/ocr/ocr.service.ts",
    "lib/ocr/templates/simulation.ts",
    "lib/ocr/templates/application.ts",
  ]) {
    const source = read(file);
    for (const [pattern, label] of FORBIDDEN_IN_LIVE_PATH) {
      assert.doesNotMatch(source, pattern, `${file} must not import ${label}`);
    }
  }
});

// The template/draft/recommendation workflow must not import the live parser or
// engines, so it cannot reach into or mutate parsing.
test("template draft/recommendation workflow does not import the live parser or engines", () => {
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
