import { MockOcrProvider } from "@/lib/ocr/mock-ocr-provider";
import type { OcrInput, OcrProvider, OcrResult } from "@/lib/ocr/types";

function getOcrProvider(): OcrProvider {
  const providerName = (process.env.OCR_PROVIDER ?? "mock").toLowerCase();

  switch (providerName) {
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

export type { OcrInput, OcrProvider, OcrResult };
