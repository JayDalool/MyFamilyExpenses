import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { Worker, WorkerOptions } from "tesseract.js";
import { OcrProviderError } from "@/lib/ocr/ocr-errors";
import { normalizeConfidence } from "@/lib/ocr/normalize";
import type { EngineResult, OcrEngine, OcrInput } from "@/lib/ocr/types";

let workerPromise: Promise<Worker> | null = null;

function isPdfFile(input: OcrInput) {
  const lowerFileName = input.fileName.toLowerCase();
  const lowerMimeType = input.mimeType?.toLowerCase();

  return lowerMimeType === "application/pdf" || lowerFileName.endsWith(".pdf");
}

function resolveLocalDirectory(configuredPath: string | undefined, fallbackPath: string) {
  if (!configuredPath) {
    return fallbackPath;
  }

  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(process.cwd(), configuredPath);
}

function getTesseractOptions(): Partial<WorkerOptions> {
  const options: Partial<WorkerOptions> = {
    cachePath: resolveLocalDirectory(
      process.env.TESSERACT_CACHE_DIR,
      path.join(process.cwd(), ".cache", "tesseract"),
    ),
  };

  if (process.env.TESSERACT_LANG_PATH) {
    options.langPath = process.env.TESSERACT_LANG_PATH;
  }

  return options;
}

async function createTesseractWorker() {
  const { createWorker } = await import("tesseract.js");
  const options = getTesseractOptions();

  if (options.cachePath) {
    await mkdir(options.cachePath, { recursive: true });
  }

  return createWorker("eng", 1, options);
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createTesseractWorker().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }

  return workerPromise;
}

// Recognition-only engine. Returns raw text + an overall score; structured field
// parsing happens in the orchestrator via the Node-owned ReceiptParser.
export class TesseractOcrEngine implements OcrEngine {
  readonly name = "tesseract";

  async recognize(input: OcrInput): Promise<EngineResult> {
    if (isPdfFile(input)) {
      throw new OcrProviderError(
        "PDF_NOT_SUPPORTED",
        "PDF OCR is not supported yet. Upload an image or continue and enter the invoice fields manually.",
      );
    }

    const imageSource =
      input.fileBytes && input.fileBytes.length > 0
        ? Buffer.from(input.fileBytes)
        : input.absolutePath;

    if (!imageSource) {
      throw new OcrProviderError(
        "OCR_FAILED",
        "No supported image data was provided for OCR.",
      );
    }

    const startedAt = Date.now();

    try {
      const worker = await getWorker();
      const { data } = await worker.recognize(imageSource);

      return {
        rawText: data.text ?? "",
        blocks: [],
        // Tesseract reports confidence on a 0–100 scale; normalize at the engine
        // boundary so everything downstream sees a provider-neutral 0–1 score.
        meanScore: normalizeConfidence(data.confidence),
        provider: this.name,
        modelVersion: "tesseract.js-eng",
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "The local OCR engine could not read this image.";

      throw new OcrProviderError(
        "OCR_FAILED",
        `The local OCR engine could not read this image. ${message}`,
      );
    }
  }
}
