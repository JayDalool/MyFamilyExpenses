import { MockOcrProvider } from "@/lib/ocr/mock-ocr-provider";
import { isOcrProviderError, OcrProviderError } from "@/lib/ocr/ocr-errors";
import { createEmptyOcrResult } from "@/lib/ocr/ocr-parsing";
import { TesseractOcrProvider } from "@/lib/ocr/tesseract-ocr-provider";
import type { OcrInput, OcrProvider, OcrResult } from "@/lib/ocr/types";

export function getConfiguredOcrProviderName() {
  return (process.env.OCR_PROVIDER ?? "tesseract").toLowerCase();
}

function getOcrProvider(): OcrProvider {
  const providerName = getConfiguredOcrProviderName();

  switch (providerName) {
    case "tesseract":
      return new TesseractOcrProvider();
    case "mock":
    default:
      return new MockOcrProvider();
  }
}

// Keep the service function stable so the rest of the app can swap to a real
// provider later without changing route handlers or pages.
export async function extractInvoiceData(input: OcrInput): Promise<OcrResult> {
  return getOcrProvider().extract(input);
}

export function createFallbackOcrResult(provider = getConfiguredOcrProviderName()) {
  return createEmptyOcrResult(provider);
}

export { isOcrProviderError, OcrProviderError };
export type { OcrInput, OcrProvider, OcrResult };
