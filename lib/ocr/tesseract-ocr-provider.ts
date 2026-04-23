import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { Worker, WorkerOptions } from "tesseract.js";
import { OcrProviderError } from "@/lib/ocr/ocr-errors";
import { createEmptyOcrResult, parseInvoiceFieldsFromText } from "@/lib/ocr/ocr-parsing";
import type { OcrInput, OcrProvider, OcrResult } from "@/lib/ocr/types";

let workerPromise: Promise<Worker> | null = null;

function isPdfFile(input: OcrInput) {
  const lowerFileName = input.fileName.toLowerCase();
  const lowerMimeType = input.mimeType?.toLowerCase();

  return (
    lowerMimeType === "application/pdf" ||
    lowerFileName.endsWith(".pdf")
  );
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

export class TesseractOcrProvider implements OcrProvider {
  readonly name = "tesseract";

  async extract(input: OcrInput): Promise<OcrResult> {
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

    try {
      const worker = await getWorker();
      const { data } = await worker.recognize(imageSource);

      return parseInvoiceFieldsFromText(
        data.text ?? "",
        this.name,
        data.confidence ?? 0,
      );
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
