export type OcrConfidence = {
  invoiceNumber: number;
  invoiceDate: number;
  amount: number;
};

export type OcrInput = {
  fileName: string;
  mimeType?: string;
  absolutePath?: string;
  fileBytes?: Uint8Array;
};

// Structured fields produced by the Node-owned ReceiptParser. This is also the
// response surfaced to the wizard, so its shape must stay stable.
export type OcrResult = {
  invoiceNumber: string;
  invoiceDate: string;
  amount: number;
  provider: string;
  confidence: OcrConfidence;
};

// ── Engine boundary (recognition only) ───────────────────────────────────────
// An OcrEngine performs text recognition and returns a provider-neutral result.
// It must NOT produce structured invoice fields — that is the parser's job.
//
// Score contract: every confidence value crossing this boundary is normalized to
// the 0–1 range BY THE ENGINE before it returns (see lib/ocr/normalize.ts).
// Engines report scores in different native units (Tesseract ~0–100, others
// 0–1), so each engine normalizes at its own edge. The parser and any future
// persistence can therefore trust that score units are always 0–1 and never have
// to guess the provider.
export type OcrBlock = {
  text: string;
  bbox?: [number, number, number, number];
  // Normalized 0–1 (engine-side). Never raw provider units.
  score: number;
};

export type EngineResult = {
  rawText: string;
  blocks: OcrBlock[];
  // Overall recognition confidence, normalized 0–1 (engine-side). Never raw
  // provider units (e.g. Tesseract's 0–100 is divided down at the boundary).
  meanScore: number;
  provider: string;
  modelVersion: string | null;
  durationMs: number;
};

export interface OcrEngine {
  readonly name: string;
  // Implementations MUST normalize meanScore and every block score to 0–1
  // before returning (use normalizeConfidence from lib/ocr/normalize.ts).
  recognize(input: OcrInput): Promise<EngineResult>;
}

// ── Internal extraction envelope ─────────────────────────────────────────────
// Produced by the orchestrator. Bundles the raw engine recognition, the parser's
// structured result, and the response shown to the UI. Internal only — it is not
// persisted yet (a trusted ReceiptExtractionAttempt is planned for a later step).
export type OcrExtractionEnvelope = {
  engineResult: EngineResult;
  parserResult: OcrResult;
  response: OcrResult;
};
