import {
  isOcrConfigError,
  isOcrProviderError,
  OcrConfigError,
  OcrProviderError,
} from "@/lib/ocr/ocr-errors";
import { writeOcrDebugArtifact } from "@/lib/ocr/ocr-debug";
import { createEmptyOcrResult, parseInvoiceFieldsFromText } from "@/lib/ocr/ocr-parsing";
import { mergeExtractions } from "@/lib/ocr/merge";
import { legacyParse } from "@/lib/ocr/legacy-parser";
import { isLowQualityImage } from "@/lib/ocr/image-quality";
import { MockOcrEngine } from "@/lib/ocr/mock-ocr-engine";
import { PaddleOcrEngine } from "@/lib/ocr/paddle-ocr-engine";
import { TesseractOcrEngine } from "@/lib/ocr/tesseract-ocr-engine";
// D.3A: dry-run static-template simulation. Imported from the specific submodule
// (NEVER the templates barrel) so database-derived drafts/recommendations are not
// pulled into the live extraction module graph.
import { resolveTemplateMode, simulateTemplates } from "@/lib/ocr/templates/simulation";
import type {
  EngineResult,
  OcrEngine,
  OcrExtractionEnvelope,
  OcrExtractionMeta,
  OcrInput,
  OcrResult,
  TemplateSimulationResult,
} from "@/lib/ocr/types";

const KNOWN_OCR_PROVIDERS = ["tesseract", "mock", "paddle"] as const;
type KnownOcrProvider = (typeof KNOWN_OCR_PROVIDERS)[number];

const OCR_STRATEGIES = ["single", "fallback", "parallel", "ensemble"] as const;
type OcrStrategy = (typeof OCR_STRATEGIES)[number];

// Below these, the primary result is "weak" and a fallback engine may help.
const FALLBACK_MIN_AMOUNT_CONFIDENCE = 0.65;
const FALLBACK_MIN_DATE_CONFIDENCE = 0.6;
const FALLBACK_MIN_TEXT_LENGTH = 40;

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

// single (default): run the selected provider only.
// fallback: run the selected provider, then a second engine only if the result
//           is weak (missing/low-confidence critical fields).
// parallel: always run both engines and merge (opt-in; for local testing).
// ensemble: parallel engines PLUS the legacy/simple parser strategy on each
//           engine's text, all merged with voting/agreement boosts.
export function resolveOcrStrategy(): OcrStrategy {
  const raw = (process.env.OCR_STRATEGY ?? "single").toLowerCase();

  if (!(OCR_STRATEGIES as readonly string[]).includes(raw)) {
    throw new OcrConfigError(
      `Unknown OCR_STRATEGY "${raw}". Allowed values: ${OCR_STRATEGIES.join(", ")}.`,
    );
  }

  return raw as OcrStrategy;
}

function engineFor(name: KnownOcrProvider): OcrEngine {
  switch (name) {
    case "tesseract":
      return new TesseractOcrEngine();
    case "mock":
      return new MockOcrEngine();
    case "paddle":
      // Throws OcrConfigError if OCR_SERVICE_URL is missing (fail closed).
      return new PaddleOcrEngine();
    default:
      throw new OcrConfigError(`Unsupported OCR provider "${name}".`);
  }
}

// Best-effort construction for a fallback engine — returns null instead of
// throwing if that engine is unavailable (e.g. paddle without OCR_SERVICE_URL).
function tryEngineFor(name: KnownOcrProvider): OcrEngine | null {
  try {
    return engineFor(name);
  } catch {
    return null;
  }
}

// The other reliable engine to pair with the primary. mock has no fallback.
function secondaryProviderName(primary: KnownOcrProvider): KnownOcrProvider | null {
  if (primary === "paddle") return "tesseract";
  if (primary === "tesseract") return "paddle";
  return null;
}

type EngineRun = { engineResult: EngineResult; parserResult: OcrResult };

async function runEngineAndParse(
  engine: OcrEngine,
  input: OcrInput,
): Promise<EngineRun> {
  const engineResult = await engine.recognize(input);
  const parserResult = parseInvoiceFieldsFromText(
    engineResult.rawText,
    engineResult.provider,
    engineResult.meanScore,
    engineResult.blocks,
  );
  return { engineResult, parserResult };
}

// Whether the primary result is weak enough to justify a second engine. Returns
// a short machine reason (for provenance) or null when the result is strong.
export function fallbackReasonFor(
  parserResult: OcrResult,
  rawText: string,
  fileBytes?: Uint8Array,
): string | null {
  if (parserResult.confidence.amount < FALLBACK_MIN_AMOUNT_CONFIDENCE) {
    return "low_amount_confidence";
  }
  if (parserResult.confidence.invoiceDate < FALLBACK_MIN_DATE_CONFIDENCE) {
    return "low_date_confidence";
  }
  if (rawText.trim().length < FALLBACK_MIN_TEXT_LENGTH) {
    return "short_text";
  }
  if (parserResult.multipleReceipts) {
    return "multiple_receipts";
  }
  if (parserResult.warnings.some((w) => /could not confidently identify/i.test(w))) {
    return "uncertain_fields";
  }
  if (fileBytes && isLowQualityImage(fileBytes)) {
    return "low_image_quality";
  }
  return null;
}

/**
 * Orchestrate one extraction across up to two engines (Layers 1–3):
 *  1. run the primary engine + parser,
 *  2. decide whether a fallback engine is needed (or always, in parallel mode),
 *  3. run the fallback and merge candidates/results.
 * The merged result is returned with provenance `meta`. Backward-compatible:
 * `single` strategy (default) behaves exactly like the prior single-engine path.
 */
export async function runExtraction(input: OcrInput): Promise<OcrExtractionEnvelope> {
  const strategy = resolveOcrStrategy();
  const primaryName = resolveOcrProviderName();

  let primary: EngineRun | null = null;
  let primaryError: unknown = null;
  try {
    primary = await runEngineAndParse(engineFor(primaryName), input);
  } catch (error) {
    // Config errors are never recoverable. In single mode, surface any error.
    if (strategy === "single" || isOcrConfigError(error)) {
      throw error;
    }
    primaryError = error;
  }

  let secondary: EngineRun | null = null;
  let secondaryName: KnownOcrProvider | null = null;
  let fallbackReason: string | null = null;

  if (strategy !== "single") {
    secondaryName = secondaryProviderName(primaryName);
    const reason = !primary
      ? "primary_failed"
      : strategy === "parallel" || strategy === "ensemble"
        ? strategy
        : fallbackReasonFor(
            primary.parserResult,
            primary.engineResult.rawText,
            input.fileBytes,
          );

    if (secondaryName && reason) {
      const secondaryEngine = tryEngineFor(secondaryName);
      if (secondaryEngine) {
        try {
          secondary = await runEngineAndParse(secondaryEngine, input);
          fallbackReason = reason;
        } catch {
          // Fallback is best-effort: a secondary failure must not break the flow.
          secondary = null;
        }
      }
    }
  }

  if (!primary && !secondary) {
    // Both engines failed (or only the primary ran and threw): surface the
    // original primary error so the route's handling is unchanged.
    throw primaryError;
  }

  const primaryRun = primary ?? secondary!;

  // Ensemble: also run the legacy/simple parser on each engine's text and fold
  // its high-precision candidates in. Agreement with the layout parser boosts
  // confidence; on its own it only fires on obvious patterns ("Total 84.80").
  const withLegacy = (run: EngineRun): OcrResult =>
    strategy === "ensemble"
      ? mergeExtractions(run.parserResult, legacyParse(run.engineResult.rawText))
      : run.parserResult;

  const merged =
    primary && secondary
      ? mergeExtractions(withLegacy(primary), withLegacy(secondary))
      : withLegacy(primaryRun);

  const providersUsed: string[] = [];
  const modelVersions: (string | null)[] = [];
  if (primary) {
    providersUsed.push(primaryName);
    modelVersions.push(primary.engineResult.modelVersion);
  }
  if (secondary && secondaryName) {
    providersUsed.push(secondaryName);
    modelVersions.push(secondary.engineResult.modelVersion);
  }

  const meta: OcrExtractionMeta = {
    strategy,
    primaryProvider: primaryName,
    fallbackProvider: secondary ? secondaryName : null,
    providersUsed,
    modelVersions,
    fallbackReason: secondary ? fallbackReason : primary ? null : "primary_failed",
  };

  const result: OcrResult = { ...merged, meta };

  await writeOcrDebugArtifact({
    input,
    rawText: primaryRun.engineResult.rawText,
    result,
    overallConfidence: primaryRun.engineResult.meanScore,
  });

  // D.3A: dry-run template simulation. Diagnostic ONLY — it never mutates `result`
  // (there is deliberately no value-application path in this phase) and is dropped
  // from every response and never persisted. Best-effort: a failure must not break
  // extraction, so it falls back to null and logs nothing that could leak text.
  let simulation: TemplateSimulationResult | null = null;
  if (resolveTemplateMode() !== "off") {
    try {
      simulation = simulateTemplates({
        merchantGuess: result.merchant || null,
        receiptType: result.receiptType,
        rawText: primaryRun.engineResult.rawText,
        candidates: result.candidates,
        parser: {
          invoiceNumber: result.invoiceNumber,
          invoiceDate: result.invoiceDate,
          amount: result.amount,
          confidence: result.confidence,
        },
        meta: { provider: meta.primaryProvider, strategy: meta.strategy },
      });
    } catch {
      simulation = null;
    }
  }

  return {
    engineResult: primaryRun.engineResult,
    parserResult: result,
    response: result,
    simulation,
  };
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
