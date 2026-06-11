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

// Thrown when OCR is misconfigured (unknown OCR_PROVIDER, or mock in production).
// Fails closed: the orchestrator never substitutes fabricated data.
export class OcrConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OcrConfigError";
  }
}

export function isOcrConfigError(error: unknown): error is OcrConfigError {
  return error instanceof OcrConfigError;
}
