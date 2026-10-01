import assert from "node:assert/strict";
import test from "node:test";
import { runExtraction } from "../lib/ocr/ocr.service";
import { OcrProviderError } from "../lib/ocr/ocr-errors";
import type { EngineResult, OcrEngine, OcrInput } from "../lib/ocr/types";

// ── Test doubles (recognition only) ──────────────────────────────────────────

class FakeSuccessEngine implements OcrEngine {
  constructor(
    readonly name: string,
    private readonly rawText: string,
    private readonly durationMs: number,
  ) {}

  async recognize(_: OcrInput): Promise<EngineResult> {
    return {
      rawText: this.rawText,
      blocks: [],
      meanScore: 0.9,
      provider: this.name,
      modelVersion: `${this.name}-test`,
      durationMs: this.durationMs,
    };
  }
}

class FakeTimeoutEngine implements OcrEngine {
  constructor(readonly name: string) {}

  async recognize(_: OcrInput): Promise<EngineResult> {
    // Mirrors the real Paddle abort path: an OCR_FAILED error flagged timedOut.
    throw new OcrProviderError(
      "OCR_FAILED",
      "The OCR service timed out after 7000ms. You can continue and enter the invoice fields manually.",
      { timedOut: true },
    );
  }
}

class FakeErrorEngine implements OcrEngine {
  constructor(readonly name: string) {}

  async recognize(_: OcrInput): Promise<EngineResult> {
    throw new OcrProviderError(
      "OCR_FAILED",
      "The OCR service could not be reached. You can continue and enter the invoice fields manually.",
    );
  }
}

async function withEnvAsync(
  overrides: Record<string, string | undefined>,
  run: () => Promise<void>,
) {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    original[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  try {
    await run();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

const IMAGE_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const INPUT: OcrInput = { fileName: "receipt.png", fileBytes: IMAGE_BYTES };

// ── 1. Paddle timeout → Tesseract fallback, recorded safely ──────────────────

test("paddle timeout then tesseract fallback records a safe paddle timeout", async () => {
  await withEnvAsync(
    { OCR_PROVIDER: "paddle", OCR_STRATEGY: "fallback", OCR_TEMPLATE_MODE: "off" },
    async () => {
      const envelope = await runExtraction(INPUT, {
        engines: {
          paddle: new FakeTimeoutEngine("paddle"),
          tesseract: new FakeSuccessEngine("tesseract", "Total 84.80\nDate 2018-01-01", 42),
        },
      });

      const diag = envelope.diagnostics;
      assert.ok(diag, "expected diagnostics on the envelope");

      const paddle = diag.engines.find((e) => e.provider === "paddle");
      assert.ok(paddle, "expected a paddle diagnostic");
      assert.equal(paddle.status, "timeout");
      assert.equal(paddle.errorCode, "OCR_FAILED");
      assert.equal(paddle.safeReason, "timeout");
      assert.equal(typeof paddle.durationMs, "number");
      assert.ok(paddle.durationMs >= 0);

      // Tesseract answered and became the selected provider.
      const tess = diag.engines.find((e) => e.provider === "tesseract");
      assert.ok(tess);
      assert.equal(tess.status, "success");
      assert.equal(diag.selectedProvider, "tesseract");
      assert.equal(envelope.response.provider, "tesseract");
    },
  );
});

test("a non-timeout paddle failure is classified as error, not timeout", async () => {
  await withEnvAsync(
    { OCR_PROVIDER: "paddle", OCR_STRATEGY: "fallback", OCR_TEMPLATE_MODE: "off" },
    async () => {
      const envelope = await runExtraction(INPUT, {
        engines: {
          paddle: new FakeErrorEngine("paddle"),
          tesseract: new FakeSuccessEngine("tesseract", "Total 5.00\nDate 2019-03-03", 12),
        },
      });

      const paddle = envelope.diagnostics?.engines.find((e) => e.provider === "paddle");
      assert.ok(paddle);
      assert.equal(paddle.status, "error");
      assert.equal(paddle.safeReason, "provider_error");
      assert.equal(paddle.errorCode, "OCR_FAILED");
    },
  );
});

test("an unavailable secondary engine is recorded as skipped, not a failure", async () => {
  await withEnvAsync(
    {
      OCR_PROVIDER: "tesseract",
      OCR_STRATEGY: "fallback",
      OCR_TEMPLATE_MODE: "off",
      // Paddle can't be constructed as the secondary without a service URL.
      OCR_SERVICE_URL: undefined,
    },
    async () => {
      const envelope = await runExtraction(INPUT, {
        // Weak primary text (< 40 chars) forces a fallback attempt.
        engines: { tesseract: new FakeSuccessEngine("tesseract", "blah", 8) },
      });

      const paddle = envelope.diagnostics?.engines.find((e) => e.provider === "paddle");
      assert.ok(paddle, "expected a skipped paddle diagnostic");
      assert.equal(paddle.status, "skipped");
      assert.equal(paddle.safeReason, "engine_unavailable");
      assert.equal(envelope.diagnostics?.selectedProvider, "tesseract");
    },
  );
});

// ── 2. Tesseract success records success duration ────────────────────────────

test("tesseract single success records its recognition duration", async () => {
  await withEnvAsync(
    { OCR_PROVIDER: "tesseract", OCR_STRATEGY: "single", OCR_TEMPLATE_MODE: "off" },
    async () => {
      const envelope = await runExtraction(INPUT, {
        engines: { tesseract: new FakeSuccessEngine("tesseract", "Total 12.50\nDate 2020-02-02", 137) },
      });

      const diag = envelope.diagnostics;
      assert.ok(diag);
      assert.equal(diag.engines.length, 1);
      const tess = diag.engines[0];
      assert.equal(tess.provider, "tesseract");
      assert.equal(tess.status, "success");
      assert.equal(tess.durationMs, 137);
      assert.equal(diag.selectedProvider, "tesseract");
      assert.equal(diag.selectedProviderDurationMs, 137);
    },
  );
});

// ── 3. Diagnostics carry no raw OCR text / blocks / receipt content ──────────

test("diagnostics never contain raw OCR text, blocks, or receipt content", async () => {
  const secret = "SECRETMERCHANT Total 999.99 Invoice ABC-123";
  await withEnvAsync(
    { OCR_PROVIDER: "tesseract", OCR_STRATEGY: "single", OCR_TEMPLATE_MODE: "off" },
    async () => {
      const envelope = await runExtraction(INPUT, {
        engines: { tesseract: new FakeSuccessEngine("tesseract", secret, 10) },
      });

      const serialized = JSON.stringify(envelope.diagnostics);
      assert.doesNotMatch(serialized, /SECRETMERCHANT/);
      assert.doesNotMatch(serialized, /999\.99/);
      assert.doesNotMatch(serialized, /ABC-123/);
      // No text-bearing keys leak into the diagnostics shape.
      for (const key of ["rawText", "text", "blocks", "candidates"]) {
        assert.doesNotMatch(serialized, new RegExp(`"${key}"`));
      }
    },
  );
});

// ── 4. Total OCR duration is tracked separately from the selected provider ───

test("total OCR duration is recorded separately from the selected provider duration", async () => {
  await withEnvAsync(
    { OCR_PROVIDER: "tesseract", OCR_STRATEGY: "single", OCR_TEMPLATE_MODE: "off" },
    async () => {
      const envelope = await runExtraction(INPUT, {
        engines: { tesseract: new FakeSuccessEngine("tesseract", "Total 5.00", 25) },
      });

      const diag = envelope.diagnostics;
      assert.ok(diag);
      assert.equal(typeof diag.totalDurationMs, "number");
      assert.ok(diag.totalDurationMs >= 0);
      // The selected-provider time is the engine's own reported recognition time,
      // distinct from the whole-orchestration total.
      assert.equal(diag.selectedProviderDurationMs, 25);
    },
  );
});

// ── 5. Existing OCR response shape stays backward-compatible ──────────────────

test("response keeps the stable OcrResult shape and carries no diagnostics", async () => {
  await withEnvAsync(
    { OCR_PROVIDER: "tesseract", OCR_STRATEGY: "single", OCR_TEMPLATE_MODE: "off" },
    async () => {
      const envelope = await runExtraction(INPUT, {
        engines: { tesseract: new FakeSuccessEngine("tesseract", "Total 5.00\nDate 2019-03-03", 5) },
      });

      const res = envelope.response as unknown as Record<string, unknown>;
      for (const key of [
        "invoiceNumber",
        "invoiceDate",
        "amount",
        "provider",
        "confidence",
        "receiptType",
        "multipleReceipts",
        "warnings",
        "candidates",
        "merchant",
      ]) {
        assert.ok(key in res, `missing core key: ${key}`);
      }
      // Diagnostics live on the envelope only — never merged into the user response.
      assert.equal("diagnostics" in res, false);
    },
  );
});
