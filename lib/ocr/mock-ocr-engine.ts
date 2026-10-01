import { normalizeConfidence } from "@/lib/ocr/normalize";
import type { EngineResult, OcrEngine, OcrInput } from "@/lib/ocr/types";

// Deterministic, recognition-only engine for development and tests. It emits
// synthetic raw text so the real ReceiptParser runs against it exactly as it
// would for a real engine. Prohibited in production by the orchestrator.
export class MockOcrEngine implements OcrEngine {
  readonly name = "mock";

  async recognize(_: OcrInput): Promise<EngineResult> {
    const suffix = Date.now().toString().slice(-6);
    const rawText = [
      "MOCK RECEIPT",
      `Invoice No: MOCK-${suffix}`,
      `Date: ${new Date().toISOString().slice(0, 10)}`,
      "Total: $24.99",
    ].join("\n");

    return {
      rawText,
      blocks: [],
      // Already in 0–1 range; normalized for parity with real engines so the
      // boundary contract (every engine emits a 0–1 score) holds uniformly.
      meanScore: normalizeConfidence(0.8),
      provider: this.name,
      modelVersion: "mock-1",
      durationMs: 0,
    };
  }
}
