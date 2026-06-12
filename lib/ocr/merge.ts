import { buildWarnings } from "@/lib/ocr/ocr-parsing";
import type {
  OcrAmountCandidate,
  OcrResult,
  OcrTextCandidate,
} from "@/lib/ocr/types";

// Confidence nudges when two independent engines are compared.
const AGREEMENT_BOOST = 0.12;
const DISAGREEMENT_FACTOR = 0.8;
const MAX_CONFIDENCE = 0.97;
const MAX_CANDIDATES = 4;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

// Normalized comparison keys so "84.8" / "84.80" and "INV-1" / "inv1" match.
function amountKey(value: number): string {
  return String(Math.round(value * 100));
}
function dateKey(value: string): string {
  return value.trim();
}
function invoiceKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

type Scalar<T> = { value: T; confidence: number; present: boolean };
type Decision<T> = { value: T; confidence: number; agreement: boolean | null };

// Merge a single best field from the two engines.
function mergeScalar<T>(
  primary: Scalar<T>,
  secondary: Scalar<T>,
  sameKey: (value: T) => string,
  empty: T,
): Decision<T> {
  if (primary.present && secondary.present) {
    if (sameKey(primary.value) === sameKey(secondary.value)) {
      // Both engines agree → boost. Keep the primary value (Paddle geometry).
      return {
        value: primary.value,
        confidence: clamp01(
          Math.min(
            MAX_CONFIDENCE,
            Math.max(primary.confidence, secondary.confidence) + AGREEMENT_BOOST,
          ),
        ),
        agreement: true,
      };
    }
    // Disagreement on a strong field → take the higher-confidence value but
    // dampen it (the UI surfaces both candidates). Wrong is worse than blank.
    const winner =
      primary.confidence >= secondary.confidence ? primary : secondary;
    return {
      value: winner.value,
      confidence: clamp01(winner.confidence * DISAGREEMENT_FACTOR),
      agreement: false,
    };
  }

  if (primary.present) {
    return { value: primary.value, confidence: primary.confidence, agreement: null };
  }
  if (secondary.present) {
    // Primary missed it; the fallback engine found it.
    return { value: secondary.value, confidence: secondary.confidence, agreement: null };
  }
  return { value: empty, confidence: 0, agreement: null };
}

type AnyCandidate = OcrTextCandidate | OcrAmountCandidate;

// Merge two ranked candidate lists: dedupe by normalized key, boost values that
// both engines produced, prefer geometry when present, and keep the top few.
function mergeCandidateList<C extends AnyCandidate>(
  primary: C[],
  secondary: C[],
  key: (value: C["value"]) => string,
): C[] {
  const byKey = new Map<string, C>();

  const absorb = (list: C[]) => {
    for (const candidate of list) {
      const k = key(candidate.value);
      const existing = byKey.get(k);
      if (!existing) {
        byKey.set(k, { ...candidate });
        continue;
      }
      byKey.set(k, {
        ...existing,
        confidence: clamp01(
          Math.min(
            MAX_CONFIDENCE,
            Math.max(existing.confidence, candidate.confidence) + AGREEMENT_BOOST,
          ),
        ),
        reason: /both engines/i.test(existing.reason)
          ? existing.reason
          : `${existing.reason} · confirmed by both engines`,
        bbox: existing.bbox ?? candidate.bbox,
        x: existing.x ?? candidate.x,
        y: existing.y ?? candidate.y,
      });
    }
  };

  absorb(primary);
  absorb(secondary);

  return Array.from(byKey.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_CANDIDATES);
}

/**
 * Merge two independent engine extractions into one. Backward-compatible: returns
 * a normal OcrResult (provenance `meta` is attached by the orchestrator). Agreement
 * boosts confidence; disagreement lowers it and surfaces both candidates.
 */
export function mergeExtractions(
  primary: OcrResult,
  secondary: OcrResult,
): OcrResult {
  const invoice = mergeScalar(
    {
      value: primary.invoiceNumber,
      confidence: primary.confidence.invoiceNumber,
      present: primary.invoiceNumber !== "" && primary.confidence.invoiceNumber > 0,
    },
    {
      value: secondary.invoiceNumber,
      confidence: secondary.confidence.invoiceNumber,
      present: secondary.invoiceNumber !== "" && secondary.confidence.invoiceNumber > 0,
    },
    invoiceKey,
    "",
  );

  const date = mergeScalar(
    {
      value: primary.invoiceDate,
      confidence: primary.confidence.invoiceDate,
      present: primary.invoiceDate !== "" && primary.confidence.invoiceDate > 0,
    },
    {
      value: secondary.invoiceDate,
      confidence: secondary.confidence.invoiceDate,
      present: secondary.invoiceDate !== "" && secondary.confidence.invoiceDate > 0,
    },
    dateKey,
    "",
  );

  const amount = mergeScalar(
    {
      value: primary.amount,
      confidence: primary.confidence.amount,
      present: primary.confidence.amount > 0,
    },
    {
      value: secondary.amount,
      confidence: secondary.confidence.amount,
      present: secondary.confidence.amount > 0,
    },
    amountKey,
    0,
  );

  const merged: OcrResult = {
    invoiceNumber: invoice.value,
    invoiceDate: date.value,
    amount: amount.value,
    provider: primary.provider,
    confidence: {
      invoiceNumber: invoice.confidence,
      invoiceDate: date.confidence,
      amount: amount.confidence,
    },
    // A real engine with geometry (Paddle) drives type/multi-receipt; the
    // fallback only fills in when the primary missed something.
    receiptType:
      primary.receiptType !== "unknown" ? primary.receiptType : secondary.receiptType,
    multipleReceipts: primary.multipleReceipts || secondary.multipleReceipts,
    warnings: [],
    candidates: {
      invoiceNumber: mergeCandidateList(
        primary.candidates.invoiceNumber,
        secondary.candidates.invoiceNumber,
        invoiceKey,
      ),
      invoiceDate: mergeCandidateList(
        primary.candidates.invoiceDate,
        secondary.candidates.invoiceDate,
        dateKey,
      ),
      amount: mergeCandidateList(
        primary.candidates.amount,
        secondary.candidates.amount,
        (value) => amountKey(value),
      ),
    },
  };

  // Recompute warnings from the merged fields so a fallback that filled a missing
  // field also clears the corresponding "needs review" warning.
  merged.warnings = buildWarnings(merged, true);
  if (
    amount.agreement === false &&
    !merged.warnings.some((w) => /different amounts/i.test(w))
  ) {
    merged.warnings.push(
      "The two OCR engines read different amounts — please confirm the total below.",
    );
  }

  return merged;
}
