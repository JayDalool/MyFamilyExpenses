import type { OcrInput, OcrProvider, OcrResult } from "@/lib/ocr/types";

export class MockOcrProvider implements OcrProvider {
  readonly name = "mock";

  async extract(_: OcrInput): Promise<OcrResult> {
    const suffix = Date.now().toString().slice(-6);

    return {
      invoiceNumber: `MOCK-${suffix}`,
      invoiceDate: new Date().toISOString().slice(0, 10),
      amount: 24.99,
      provider: this.name,
      confidence: {
        invoiceNumber: 0.82,
        invoiceDate: 0.84,
        amount: 0.78,
      },
    };
  }
}
