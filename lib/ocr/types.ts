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

export type OcrResult = {
  invoiceNumber: string;
  invoiceDate: string;
  amount: number;
  provider: string;
  confidence: OcrConfidence;
};

export interface OcrProvider {
  readonly name: string;
  extract(input: OcrInput): Promise<OcrResult>;
}
