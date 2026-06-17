import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { PARSER_VERSION } from "@/lib/ocr/ocr-parsing";
import { getImageDimensions, isLowQualityForOcr } from "@/lib/ocr/image-quality";
import type { OcrBlock, OcrExtractionEnvelope } from "@/lib/ocr/types";

// Attempts are short-lived: they only bridge /extract → save for one upload.
export const EXTRACTION_ATTEMPT_TTL_MINUTES = 60;
const TTL_MS = EXTRACTION_ATTEMPT_TTL_MINUTES * 60_000;

// Hard caps so a hostile/garbled engine response can't bloat the row.
const MAX_RAW_TEXT = 20_000;
const MAX_BLOCKS = 2_000;

const asJson = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

/** Stable fingerprint of the uploaded bytes (hex sha256). */
export function computeFileSha256(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

/**
 * Redact card/account-number-like digit runs from free text before storage.
 * Conservative: leaves dates (2018-01-01), amounts (84.80), and short invoice
 * numbers (INV-2026-001, 004615-312-001) intact, but masks card numbers, long
 * account numbers, phone numbers, and masked-card forms.
 */
export function redactSensitiveText(text: string): string {
  return text
    .replace(/\b(?:\d[ -]?){13,19}\b/g, "[REDACTED]") // card-like (13–19 digits)
    .replace(/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g, "[REDACTED]") // phone numbers
    .replace(/\b\d{9,}\b/g, "[REDACTED]") // long account/number runs
    .replace(/[*xX]{4,}[ -]?\d{2,4}\b/g, "[REDACTED]"); // masked card (xxxx1234)
}

function redactBlocks(blocks: OcrBlock[]): OcrBlock[] {
  return blocks.slice(0, MAX_BLOCKS).map((block) => ({
    ...block,
    text: redactSensitiveText(block.text),
  }));
}

type CreateAttemptArgs = {
  userId: string;
  householdId: string;
  fileSha256: string;
  fileBytes: Uint8Array;
  envelope: OcrExtractionEnvelope;
};

/**
 * Persist a trusted, server-side snapshot of what OCR/the parser produced, BEFORE
 * the user edits anything. Tenant-scoped via the composite membership FK. Returns
 * the new attempt id, or null on failure (the caller treats this as best-effort —
 * extraction still succeeds for the user without an attempt).
 */
export async function createExtractionAttempt(
  args: CreateAttemptArgs,
): Promise<string | null> {
  const { userId, householdId, fileSha256, fileBytes, envelope } = args;
  const { engineResult, parserResult } = envelope;
  // What the user actually saw: the post-application response when D.3B applied a
  // template, otherwise identical to parserResult. Recording this makes Phase C
  // correction feedback compare the user's final values against the template-
  // assisted prediction. Falls back to parserResult for hand-built envelopes.
  const seen = envelope.response ?? parserResult;
  const meta = parserResult.meta;

  const dimensions = getImageDimensions(fileBytes);
  const imageQuality = {
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    lowQuality: isLowQualityForOcr(dimensions),
  };

  try {
    const attempt = await prisma.receiptExtractionAttempt.create({
      data: {
        userId,
        householdId,
        fileSha256,
        provider: parserResult.provider,
        strategy: meta?.strategy ?? "single",
        providersUsed: asJson(meta?.providersUsed ?? [parserResult.provider]),
        modelVersions: asJson(meta?.modelVersions ?? [engineResult.modelVersion]),
        parserVersion: PARSER_VERSION,
        rawText: redactSensitiveText(engineResult.rawText).slice(0, MAX_RAW_TEXT),
        blocks: asJson(redactBlocks(engineResult.blocks)),
        candidates: asJson(parserResult.candidates),
        selectedExtraction: asJson({
          invoiceNumber: seen.invoiceNumber,
          invoiceDate: seen.invoiceDate,
          amount: seen.amount,
          merchant: seen.merchant,
        }),
        warnings: asJson(parserResult.warnings),
        receiptType: parserResult.receiptType,
        merchantGuess: parserResult.merchant
          ? redactSensitiveText(parserResult.merchant)
          : null,
        imageQuality: asJson(imageQuality),
        confidence: asJson(seen.confidence),
        durationMs: Math.max(0, Math.round(engineResult.durationMs ?? 0)),
        expiresAt: new Date(Date.now() + TTL_MS),
      },
      select: { id: true },
    });
    return attempt.id;
  } catch {
    // Best-effort: never block the user's extraction on attempt persistence.
    return null;
  }
}

type ConsumeAttemptArgs = {
  attemptId: string;
  userId: string;
  householdId: string;
  fileSha256: string;
  expenseId: string;
};

/**
 * Atomically claim an attempt for an expense. The single-use + tenant + freshness
 * guarantees live entirely in this conditional UPDATE: a row is claimed only if it
 * belongs to this user+household, matches the uploaded file, is unexpired, and is
 * not already consumed. Returns true iff exactly one row was claimed. Never
 * throws to the caller's critical path (a failed link must not undo a saved
 * expense).
 */
export async function consumeExtractionAttempt(
  args: ConsumeAttemptArgs,
): Promise<boolean> {
  try {
    const result = await prisma.receiptExtractionAttempt.updateMany({
      where: {
        id: args.attemptId,
        userId: args.userId,
        householdId: args.householdId,
        fileSha256: args.fileSha256,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: {
        consumedAt: new Date(),
        consumedByExpenseId: args.expenseId,
      },
    });
    return result.count === 1;
  } catch {
    return false;
  }
}

/** Delete expired or already-consumed attempts. For a scheduled cleanup job. */
export async function deleteStaleExtractionAttempts(now: Date = new Date()) {
  return prisma.receiptExtractionAttempt.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: now } }, { consumedAt: { not: null } }],
    },
  });
}
