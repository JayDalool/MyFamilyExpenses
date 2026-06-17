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

// Coarse receipt classification (Stage A). Drives field strategy — e.g. a bank
// deposit/informational slip should not have an amount confidently auto-filled.
export type ReceiptType =
  | "retail"
  | "restaurant"
  | "bank_withdrawal"
  | "bank_deposit"
  | "transfer"
  | "informational"
  | "unknown";

// One ranked extraction candidate for a field. `value` is a string for
// invoice/date and a number for amount. `sourceLabel` is the receipt label the
// value came from (e.g. "Total", "Withdraw", "Invoice No"); `reason` is a short
// human explanation of why it ranked where it did. bbox/x/y are best-effort and
// only present when block geometry was available.
export type OcrCandidate<T> = {
  value: T;
  confidence: number;
  sourceLabel: string;
  reason: string;
  // Which engine/strategy produced this candidate (e.g. "paddle", "tesseract",
  // "legacy"). Optional/additive — older producers may omit it.
  source?: string;
  bbox?: [number, number, number, number];
  x?: number;
  y?: number;
};

export type OcrTextCandidate = OcrCandidate<string>;
export type OcrAmountCandidate = OcrCandidate<number>;

export type OcrCandidates = {
  invoiceNumber: OcrTextCandidate[];
  invoiceDate: OcrTextCandidate[];
  amount: OcrAmountCandidate[];
  // Merchant/vendor name candidates (top-of-receipt). Used as a receipt-label
  // fallback when no invoice/reference number exists.
  merchant: OcrTextCandidate[];
};

// Provenance for a (possibly multi-engine) extraction. Additive/optional so the
// single-engine path and existing consumers are unaffected.
export type OcrExtractionMeta = {
  strategy: "single" | "fallback" | "parallel" | "ensemble";
  primaryProvider: string;
  fallbackProvider: string | null;
  providersUsed: string[];
  modelVersions: (string | null)[];
  fallbackReason: string | null;
};

// Structured fields produced by the Node-owned ReceiptParser. The first five
// fields are the stable wizard contract; the Stage A fields below are additive
// (ranked candidates, classification, multi-receipt detection, warnings) and the
// existing UI ignores any it does not use.
export type OcrResult = {
  invoiceNumber: string;
  invoiceDate: string;
  amount: number;
  provider: string;
  confidence: OcrConfidence;
  // ── Stage A additive intelligence ──
  receiptType: ReceiptType;
  multipleReceipts: boolean;
  warnings: string[];
  candidates: OcrCandidates;
  // Best merchant/vendor guess (top of receipt), or "" if none. Used only as a
  // display/label fallback — never presented as an OCR-detected invoice number.
  merchant: string;
  // ── Stage A.2 provenance (set by the orchestrator, optional) ──
  meta?: OcrExtractionMeta;
};

// ── Engine boundary (recognition only) ───────────────────────────────────────
// An OcrEngine performs text recognition and returns a provider-neutral result.
// It must NOT produce structured invoice fields — that is the parser's job.
//
// Score contract: every confidence value crossing this boundary is normalized to
// the 0–1 range BY THE ENGINE before it returns (see lib/ocr/normalize.ts).
// Engines report scores in different native units (Tesseract ~0–100, others
// 0–1), so each engine normalizes at its own edge. The parser and any future
// persistence can therefore trust that score units are always 0–1 and never have
// to guess the provider.
export type OcrBlock = {
  text: string;
  bbox?: [number, number, number, number];
  // Normalized 0–1 (engine-side). Never raw provider units.
  score: number;
};

export type EngineResult = {
  rawText: string;
  blocks: OcrBlock[];
  // Overall recognition confidence, normalized 0–1 (engine-side). Never raw
  // provider units (e.g. Tesseract's 0–100 is divided down at the boundary).
  meanScore: number;
  provider: string;
  modelVersion: string | null;
  durationMs: number;
};

export interface OcrEngine {
  readonly name: string;
  // Implementations MUST normalize meanScore and every block score to 0–1
  // before returning (use normalizeConfidence from lib/ocr/normalize.ts).
  recognize(input: OcrInput): Promise<EngineResult>;
}

// ── Static template simulation (Phase D.3A) ──────────────────────────────────
// Diagnostic-only result of running code-reviewed static templates against a
// parser result in DRY-RUN. It NEVER changes extraction values and is never
// persisted or returned to end users. The result type lives here (core types) so
// the envelope can reference it without a cycle through the templates module.
export type SimulationDecision =
  | "no_match"
  | "same_as_parser"
  | "would_improve"
  | "would_conflict"
  | "unsafe";

export type TemplateSimulationResult = {
  matchedTemplateId: string | null;
  templateName: string | null;
  suggestedAmount: number | null;
  suggestedDate: string | null;
  suggestedInvoice: string | null;
  // template-suggested confidence minus the parser's amount confidence (0 if none).
  confidenceDelta: number;
  warnings: string[];
  decision: SimulationDecision;
  reasons: string[];
};

// ── Internal extraction envelope ─────────────────────────────────────────────
// Produced by the orchestrator. Bundles the raw engine recognition, the parser's
// structured result, and the response shown to the UI. Internal only — it is not
// returned to the client directly (the route forwards `response` only) and is not
// persisted as-is.
export type OcrExtractionEnvelope = {
  engineResult: EngineResult;
  parserResult: OcrResult;
  response: OcrResult;
  // Dry-run template simulation (D.3A). Diagnostic, internal-only, best-effort
  // (null on failure or when OCR_TEMPLATE_MODE=off). Dropped from every response
  // and never written to the DB.
  simulation?: TemplateSimulationResult | null;
};
