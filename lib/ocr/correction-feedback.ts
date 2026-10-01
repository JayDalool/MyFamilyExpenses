import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

// Phase C: durable predicted-vs-final correction feedback. This module is the
// learning-corpus foundation — it captures what OCR predicted against what the
// user actually saved, after a successful expense save that consumed a trusted
// ReceiptExtractionAttempt. It NEVER stores raw OCR text, blocks, or file bytes,
// and it does not change parser rules (that is Phase D vendor-template work).

const asJson = (value: unknown): Prisma.InputJsonValue =>
  (value ?? null) as Prisma.InputJsonValue;

const numOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

// ── Normalization (pure) ─────────────────────────────────────────────────────

/** Trim + lowercase a reference/invoice value; empty → null. */
export function normalizeReference(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.toLowerCase();
}

/** Reduce any date-ish string to a bare yyyy-mm-dd; non-matching → null. */
export function normalizeDate(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/** Convert money to integer cents for Decimal-safe comparison; non-finite → null. */
export function normalizeAmountCents(
  value: number | string | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/**
 * Changed iff the normalized predicted and final values differ. Both missing →
 * not changed. Predicted missing but final present → changed (OCR missed it).
 * Predicted present but final differs → changed (user corrected it).
 */
export function isChanged(
  predicted: string | number | null,
  final: string | number | null,
): boolean {
  return predicted !== final;
}

// ── Candidate summary (value-free) ───────────────────────────────────────────
// We deliberately keep ONLY counts + the top candidate's confidence/source. The
// candidate `value` strings in an attempt are unredacted, so copying them into
// the durable feedback row would leak merchant/invoice PII. Counts and scores are
// enough to study how often the right answer was ranked first.

export type FieldCandidateSummary = {
  count: number;
  topConfidence: number | null;
  topSource: string | null;
};

function summarizeField(list: unknown): FieldCandidateSummary {
  if (!Array.isArray(list) || list.length === 0) {
    return { count: 0, topConfidence: null, topSource: null };
  }
  const top = list[0] as { confidence?: unknown; source?: unknown };
  return {
    count: list.length,
    topConfidence: numOrNull(top?.confidence),
    topSource: typeof top?.source === "string" ? top.source : null,
  };
}

export function summarizeCandidates(candidates: unknown) {
  const c = (candidates ?? {}) as Record<string, unknown>;
  return {
    invoiceNumber: summarizeField(c.invoiceNumber),
    invoiceDate: summarizeField(c.invoiceDate),
    amount: summarizeField(c.amount),
    merchant: summarizeField(c.merchant),
  };
}

// ── Payload builder (pure) ───────────────────────────────────────────────────

/** The subset of a ReceiptExtractionAttempt needed to derive feedback. */
export type AttemptForFeedback = {
  id: string;
  receiptType: string;
  merchantGuess: string | null;
  parserVersion: string;
  provider: string;
  strategy: string;
  providersUsed: unknown;
  selectedExtraction: unknown;
  confidence: unknown;
  candidates: unknown;
  warnings: unknown;
};

/** The final, saved expense values to compare predictions against. */
export type FinalExpenseValues = {
  invoiceNumber: string;
  invoiceDate: string;
  amount: number;
  categoryId: string;
  paidByUserId: string;
};

/**
 * Build the derived feedback payload. PURE (no DB) so the privacy/normalization/
 * changed-detection guarantees are unit-testable without a database. Predicted
 * values are NOT confidence-gated: a correct-but-under-confident prediction must
 * read as "not changed", which is the signal template learning needs.
 */
export function buildCorrectionFeedbackPayload(
  attempt: AttemptForFeedback,
  final: FinalExpenseValues,
) {
  const sel = (attempt.selectedExtraction ?? {}) as {
    invoiceNumber?: unknown;
    invoiceDate?: unknown;
    amount?: unknown;
  };
  const conf = (attempt.confidence ?? {}) as {
    invoiceNumber?: unknown;
    invoiceDate?: unknown;
    amount?: unknown;
  };

  const predictedInvoiceNumber =
    typeof sel.invoiceNumber === "string" && sel.invoiceNumber.trim() !== ""
      ? sel.invoiceNumber.trim()
      : null;
  const predictedInvoiceDate =
    typeof sel.invoiceDate === "string" && sel.invoiceDate.trim() !== ""
      ? sel.invoiceDate.trim()
      : null;
  // The parser uses 0 as its documented "no amount" sentinel.
  const predictedAmount =
    typeof sel.amount === "number" && Number.isFinite(sel.amount) && sel.amount > 0
      ? sel.amount
      : null;
  // Merchant comes ONLY from the pre-redacted merchantGuess column.
  // selectedExtraction.merchant and candidate values are unredacted — never copy
  // those into the durable row.
  const predictedMerchant =
    typeof attempt.merchantGuess === "string" && attempt.merchantGuess.trim() !== ""
      ? attempt.merchantGuess.trim()
      : null;

  const finalInvoiceNumber =
    typeof final.invoiceNumber === "string" && final.invoiceNumber.trim() !== ""
      ? final.invoiceNumber.trim()
      : null;
  const finalInvoiceDate =
    typeof final.invoiceDate === "string" && final.invoiceDate.trim() !== ""
      ? final.invoiceDate.trim()
      : null;

  return {
    receiptType: attempt.receiptType,
    merchantGuess: attempt.merchantGuess ?? null,
    parserVersion: attempt.parserVersion,
    provider: attempt.provider,
    strategy: attempt.strategy,
    providersUsed: attempt.providersUsed,
    categoryId: final.categoryId,
    paidByUserId: final.paidByUserId,

    predictedInvoiceNumber,
    finalInvoiceNumber,
    invoiceNumberChanged: isChanged(
      normalizeReference(predictedInvoiceNumber),
      normalizeReference(finalInvoiceNumber),
    ),
    invoiceNumberConfidence: numOrNull(conf.invoiceNumber),

    predictedInvoiceDate,
    finalInvoiceDate,
    invoiceDateChanged: isChanged(
      normalizeDate(predictedInvoiceDate),
      normalizeDate(finalInvoiceDate),
    ),
    invoiceDateConfidence: numOrNull(conf.invoiceDate),

    predictedAmount,
    finalAmount: final.amount,
    amountChanged: isChanged(
      normalizeAmountCents(predictedAmount),
      normalizeAmountCents(final.amount),
    ),
    amountConfidence: numOrNull(conf.amount),

    predictedMerchant,
    // No merchant field on Expense yet, so there is nothing to compare against.
    finalMerchant: null as string | null,
    merchantChanged: null as boolean | null,

    warnings: attempt.warnings ?? [],
    candidatesSummary: summarizeCandidates(attempt.candidates),
  };
}

// ── Persistence (best-effort) ────────────────────────────────────────────────

type RecordFeedbackArgs = {
  attemptId: string;
  expenseId: string;
  userId: string;
  householdId: string;
  final: FinalExpenseValues;
};

/**
 * Write a durable correction-feedback row. Best-effort: a failure here must NEVER
 * fail the expense save (the user's primary artifact is already persisted). The
 * source attempt is re-fetched scoped by id + the expense it was just linked to +
 * tenant, so feedback can only ever describe a genuinely consumed, in-tenant
 * attempt. Returns true iff a row was written.
 */
export async function recordCorrectionFeedback(
  args: RecordFeedbackArgs,
): Promise<boolean> {
  try {
    const attempt = await prisma.receiptExtractionAttempt.findFirst({
      where: {
        id: args.attemptId,
        consumedByExpenseId: args.expenseId,
        userId: args.userId,
        householdId: args.householdId,
      },
      select: {
        id: true,
        receiptType: true,
        merchantGuess: true,
        parserVersion: true,
        provider: true,
        strategy: true,
        providersUsed: true,
        selectedExtraction: true,
        confidence: true,
        candidates: true,
        warnings: true,
      },
    });
    if (!attempt) return false;

    const payload = buildCorrectionFeedbackPayload(attempt, args.final);

    await prisma.receiptCorrectionFeedback.create({
      data: {
        userId: args.userId,
        householdId: args.householdId,
        expenseId: args.expenseId,
        attemptId: attempt.id,
        receiptType: payload.receiptType,
        merchantGuess: payload.merchantGuess,
        parserVersion: payload.parserVersion,
        provider: payload.provider,
        strategy: payload.strategy,
        providersUsed: asJson(payload.providersUsed),
        categoryId: payload.categoryId,
        paidByUserId: payload.paidByUserId,
        predictedInvoiceNumber: payload.predictedInvoiceNumber,
        finalInvoiceNumber: payload.finalInvoiceNumber,
        invoiceNumberChanged: payload.invoiceNumberChanged,
        invoiceNumberConfidence: payload.invoiceNumberConfidence,
        predictedInvoiceDate: payload.predictedInvoiceDate,
        finalInvoiceDate: payload.finalInvoiceDate,
        invoiceDateChanged: payload.invoiceDateChanged,
        invoiceDateConfidence: payload.invoiceDateConfidence,
        predictedAmount: payload.predictedAmount,
        finalAmount: payload.finalAmount,
        amountChanged: payload.amountChanged,
        amountConfidence: payload.amountConfidence,
        predictedMerchant: payload.predictedMerchant,
        finalMerchant: payload.finalMerchant,
        merchantChanged: payload.merchantChanged,
        warnings: asJson(payload.warnings),
        candidatesSummary: asJson(payload.candidatesSummary),
      },
    });
    return true;
  } catch (error) {
    // Safe metadata only — never raw OCR text.
    console.error(
      "correction-feedback: record failed",
      error instanceof Error ? error.name : "UNKNOWN_ERROR",
    );
    return false;
  }
}
