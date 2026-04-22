export type OcrResult = {
  invoiceNumber: string;
  invoiceDate: string;
  amount: number;
  provider: "mock-ocr";
  confidence: {
    invoiceNumber: number;
    invoiceDate: number;
    amount: number;
  };
};

type OcrInput = {
  fileName: string;
};

// This is the seam for a real OCR provider later.
export async function extractInvoiceData(_: OcrInput): Promise<OcrResult> {
  const suffix = Date.now().toString().slice(-6);

  return {
    invoiceNumber: `MOCK-${suffix}`,
    invoiceDate: new Date().toISOString().slice(0, 10),
    amount: 24.99,
    provider: "mock-ocr",
    confidence: {
      invoiceNumber: 0.82,
      invoiceDate: 0.84,
      amount: 0.78,
    },
  };
}
