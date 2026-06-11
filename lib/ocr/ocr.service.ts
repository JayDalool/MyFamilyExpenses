import {
  isOcrConfigError,
  isOcrProviderError,
  OcrConfigError,
  OcrProviderError,
} from "@/lib/ocr/ocr-errors";
import { writeOcrDebugArtifact } from "@/lib/ocr/ocr-debug";
import { createEmptyOcrResult, parseInvoiceFieldsFromText } from "@/lib/ocr/ocr-parsing";
import { MockOcrEngine } from "@/lib/ocr/mock-ocr-engine";
import { TesseractOcrEngine } from "@/lib/ocr/tesseract-ocr-engine";
import type {
  EngineResult,
  OcrEngine,
  OcrExtractionEnvelope,
  OcrInput,
  OcrResult,
} from "@/lib/ocr/types";

const KNOWN_OCR_PROVIDERS = ["tesseract", "mock"] as const;
type KnownOcrProvider = (typeof KNOWN_OCR_PROVIDERS)[number];

// Raw configured name (non-throwing). Used only for labelling fallback results.
export function getConfiguredOcrProviderName() {
  return (process.env.OCR_PROVIDER ?? "tesseract").toLowerCase();
}

// Validated provider name. Fails CLOSED: an unknown OCR_PROVIDER (e.g. a typo
// like "paddleocr") or selecting "mock" in production throws rather than
// silently fabricating financial data.
export function resolveOcrProviderName(): KnownOcrProvider {
  const name = getConfiguredOcrProviderName();

  if (!(KNOWN_OCR_PROVIDERS as readonly string[]).includes(name)) {
    throw new OcrConfigError(
      `Unknown OCR_PROVIDER "${name}". Allowed values: ${KNOWN_OCR_PROVIDERS.join(", ")}.`,
    );
  }

  if (name === "mock" && process.env.NODE_ENV === "production") {
    throw new OcrConfigError('The "mock" OCR provider is not allowed in production.');
  }

  return name as KnownOcrProvider;
}

function getOcrEngine(): OcrEngine {
  const name = resolveOcrProviderName();

  switch (name) {
    case "tesseract":
      return new TesseractOcrEngine();
    case "mock":
      return new MockOcrEngine();
    default:
      // Unreachable: resolveOcrProviderName already validated the name.
      throw new OcrConfigError(`Unsupported OCR provider "${name}".`);
  }
}

/**
 * Orchestrate one extraction: run the engine (recognition only), then the
 * Node-owned parser (structured fields), and bundle both plus the UI response
 * into an internal envelope. The envelope is the seam a trusted, persisted
 * ReceiptExtractionAttempt will hang off later — for now it is in-memory only.
 */
export async function runExtraction(input: OcrInput): Promise<OcrExtractionEnvelope> {
  const engine = getOcrEngine();
  const engineResult: EngineResult = await engine.recognize(input);
  const parserResult = parseInvoiceFieldsFromText(
    engineResult.rawText,
    engineResult.provider,
    engineResult.meanScore,
  );

  await writeOcrDebugArtifact({
    input,
    rawText: engineResult.rawText,
    result: parserResult,
    overallConfidence: engineResult.meanScore,
  });

  return { engineResult, parserResult, response: parserResult };
}

// Stable entry point for routes/pages: returns the UI-facing structured result.
export async function extractInvoiceData(input: OcrInput): Promise<OcrResult> {
  return (await runExtraction(input)).response;
}

export function createFallbackOcrResult(provider = getConfiguredOcrProviderName()) {
  return createEmptyOcrResult(provider);
}

export { isOcrConfigError, isOcrProviderError, OcrConfigError, OcrProviderError };
export type { EngineResult, OcrEngine, OcrExtractionEnvelope, OcrInput, OcrResult };
