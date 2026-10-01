import type { ReceiptType } from "../../../lib/ocr/types";

// A small, anonymized regression fixture for the OCR parser and future merchant
// templates. Expectations are intentionally lenient (acceptable receipt types,
// the expected confident amount, and amounts that must NEVER be chosen) so the
// dataset catches real regressions without being brittle to confidence tweaks.
export type ReceiptFixture = {
  name: string;
  description: string;
  rawText: string;
  expect: {
    receiptType: ReceiptType[];
    /** The amount the parser should choose when it confidently detects one. */
    amount?: number;
    /** Whether a usable invoice/reference number is plausibly present. */
    invoiceLikely: boolean;
    /** Values that must never be selected as the amount (change, balance, card digits). */
    mustNotEqualAmount?: number[];
  };
  /**
   * Optional Phase D.4 template-behavior expectations. Absent → the benchmark only
   * checks parser/safety, leaving existing fixtures untouched.
   */
  expectTemplate?: {
    /** Whether a static template should match this receipt. */
    matches: boolean;
    /** The expected matched template id (when `matches`). */
    templateId?: string | null;
    /** Whether guarded application (apply gate open) would fill the amount. */
    appliesAmount?: boolean;
    /** Whether guarded application would fill the date. */
    appliesDate?: boolean;
  };
};
