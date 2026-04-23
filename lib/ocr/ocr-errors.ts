export type OcrErrorCode = "OCR_FAILED" | "PDF_NOT_SUPPORTED";

export class OcrProviderError extends Error {
  readonly code: OcrErrorCode;

  constructor(code: OcrErrorCode, message: string) {
    super(message);
    this.name = "OcrProviderError";
    this.code = code;
  }
}

export function isOcrProviderError(error: unknown): error is OcrProviderError {
  return error instanceof OcrProviderError;
}
