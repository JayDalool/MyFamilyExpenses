import type { OcrResult } from "@/lib/ocr/types";

type MatchCandidate<T> = {
  value: T;
  confidence: number;
  score: number;
} | null;

type AmountToken = {
  value: number;
  raw: string;
  hasCurrency: boolean;
  hasDecimals: boolean;
};

type AmountCandidate = {
  value: number;
  confidence: number;
  score: number;
};

type DateCandidate = {
  value: string;
  confidence: number;
  score: number;
};

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const DATE_LABEL_PATTERNS = [
  /\bdate\b/i,
  /\bdated\b/i,
  /\bpurchase\s+date\b/i,
  /\btransaction\s+date\b/i,
  /\btxn\s+date\b/i,
  /\binvoice\s+date\b/i,
  /\breceipt\s+date\b/i,
  /\bissued\b/i,
];

const STRONG_AMOUNT_RULES = [
  { pattern: /\bgrand\s+total\b/i, score: 1.35, confidence: 0.96 },
  { pattern: /\bamount\s+paid\b/i, score: 1.28, confidence: 0.95 },
  { pattern: /\btotal\s+paid\b/i, score: 1.24, confidence: 0.94 },
  { pattern: /\bpayment\s+total\b/i, score: 1.18, confidence: 0.93 },
  { pattern: /\bbalance\s+due\b/i, score: 1.15, confidence: 0.92 },
  { pattern: /\btotal\s+due\b/i, score: 1.12, confidence: 0.91 },
  { pattern: /\binvoice\s+total\b/i, score: 1.08, confidence: 0.9 },
  { pattern: /\bamount\b/i, score: 0.74, confidence: 0.72 },
  { pattern: /(?:^|\b)total(?:\b|$)/i, score: 0.98, confidence: 0.84 },
];

const NEGATIVE_AMOUNT_PATTERNS = {
  subtotal: /\bsub[\s-]?total\b/i,
  tax: /\b(?:tax|gst|pst|hst|vat|iva)\b/i,
  taxTotal: /\b(?:tax\s+total|total\s+tax)\b/i,
  tip: /\btip\b/i,
  change: /\bchange\b/i,
  tendered: /\b(?:cash|tender(?:ed)?|paid\s+out)\b/i,
  discount: /\b(?:discount|savings?)\b/i,
  rounding: /\bround(?:ing)?\b/i,
};

const POSITIVE_AMOUNT_LINE_PATTERN = /\b(?:grand\s+total|amount\s+paid|total\s+paid|payment\s+total|balance\s+due|total\s+due|invoice\s+total|total|amount)\b/i;

const INLINE_INVOICE_LABEL_PATTERN =
  /\b(?:invoice|receipt|trans(?:action)?|tran|txn|check|order|bill|ref(?:erence)?|ticket)\s*(?:no|#|number|num|id)?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9/.-]{2,})/i;

const SPLIT_INVOICE_LABEL_PATTERN =
  /\b(?:invoice|receipt|trans(?:action)?|tran|txn|check|order|bill|ref(?:erence)?|ticket)\s*(?:no|#|number|num|id)?\b/i;

const INVOICE_IGNORE_LINE_PATTERN =
  /\b(?:phone|tel|telephone|fax|mobile|customer\s+service|store|location|branch|register|terminal|cashier|clerk|server)\b/i;

const PHONE_PATTERN =
  /(?:\+?\d{1,2}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/;

const WEAK_INVOICE_PATTERN = /\b(?:[A-Za-z]{1,6}[-/]?\d{3,}[A-Za-z0-9/-]*|\d{3,}[A-Za-z]{1,6}[A-Za-z0-9/-]*)\b/g;

function clampConfidence(value: number) {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function scaleConfidence(base: number, floor: number, ceiling: number) {
  return clampConfidence(Math.max(floor, Math.min(ceiling, base)));
}

function normalizeLines(rawText: string) {
  return rawText
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function pickBestCandidate<T extends { score: number; confidence: number }>(
  candidates: T[],
) {
  if (candidates.length === 0) {
    return null;
  }

  return candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return right.confidence - left.confidence;
  })[0];
}

function toIsoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function normalizeYear(year: number) {
  if (year >= 100) {
    return year;
  }

  return year >= 70 ? 1900 + year : 2000 + year;
}

function parseNamedMonthDate(value: string) {
  const monthFirst = value.match(
    /\b([A-Za-z]{3,9})\s+(\d{1,2})(?:,)?\s+((?:19|20)?\d{2})\b/i,
  );

  if (monthFirst) {
    const month = MONTH_NAMES[monthFirst[1].toLowerCase()];
    const day = Number(monthFirst[2]);
    const year = normalizeYear(Number(monthFirst[3]));
    return month ? toIsoDate(year, month, day) : null;
  }

  const dayFirst = value.match(
    /\b(\d{1,2})\s+([A-Za-z]{3,9})(?:,)?\s+((?:19|20)?\d{2})\b/i,
  );

  if (!dayFirst) {
    return null;
  }

  const month = MONTH_NAMES[dayFirst[2].toLowerCase()];
  const day = Number(dayFirst[1]);
  const year = normalizeYear(Number(dayFirst[3]));

  return month ? toIsoDate(year, month, day) : null;
}

function parseCompactDate(value: string) {
  const compact = value.match(/\b((?:19|20)\d{2})(\d{2})(\d{2})\b/);

  if (!compact) {
    return null;
  }

  return toIsoDate(
    Number(compact[1]),
    Number(compact[2]),
    Number(compact[3]),
  );
}

function parseNumericDate(value: string) {
  const isoLike = value.match(
    /\b((?:19|20)\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/,
  );

  if (isoLike) {
    return toIsoDate(
      Number(isoLike[1]),
      Number(isoLike[2]),
      Number(isoLike[3]),
    );
  }

  const slashLike = value.match(
    /\b(\d{1,2})([-/.])(\d{1,2})\2((?:19|20)?\d{2})\b/,
  );

  if (!slashLike) {
    return null;
  }

  const first = Number(slashLike[1]);
  const separator = slashLike[2];
  const second = Number(slashLike[3]);
  const year = normalizeYear(Number(slashLike[4]));

  if (first > 12 && second <= 12) {
    return toIsoDate(year, second, first);
  }

  if (second > 12 && first <= 12) {
    return toIsoDate(year, first, second);
  }

  if (separator === ".") {
    return toIsoDate(year, second, first);
  }

  return toIsoDate(year, first, second);
}

function parseDateValue(value: string) {
  return (
    parseNumericDate(value) ??
    parseNamedMonthDate(value) ??
    parseCompactDate(value)
  );
}

function findInvoiceDate(
  lines: string[],
  overallConfidence: number,
): MatchCandidate<string> {
  const candidates: DateCandidate[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextLine = lines[index + 1];
    const hasDateLabel = DATE_LABEL_PATTERNS.some((pattern) => pattern.test(line));
    const labeledContext = nextLine ? `${line} ${nextLine}` : line;

    if (hasDateLabel) {
      const parsed = parseDateValue(labeledContext);

      if (parsed) {
        candidates.push({
          value: parsed,
          confidence: scaleConfidence(overallConfidence * 0.86 + 0.12, 0.62, 0.96),
          score: 1.2,
        });
      }
    }

    const genericParsed = parseDateValue(line);

    if (genericParsed) {
      candidates.push({
        value: genericParsed,
        confidence: scaleConfidence(overallConfidence * 0.58 + 0.05, 0.32, 0.78),
        score: hasDateLabel ? 0.95 : 0.55,
      });
    }
  }

  return pickBestCandidate(candidates);
}

function normalizeInvoiceNumber(candidate: string) {
  return candidate.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9/.-]+$/g, "");
}

function looksLikePhoneNumber(candidate: string) {
  const digitsOnly = candidate.replace(/\D/g, "");

  return (
    PHONE_PATTERN.test(candidate) ||
    (/^[\d().+\s-]+$/.test(candidate) &&
      digitsOnly.length >= 10 &&
      digitsOnly.length <= 12)
  );
}

function isInvoiceNumberCandidate(
  candidate: string,
  strength: "strong" | "weak",
) {
  const normalized = normalizeInvoiceNumber(candidate);

  if (
    normalized.length < 3 ||
    normalized.length > 32 ||
    !/\d/.test(normalized) ||
    looksLikePhoneNumber(normalized) ||
    /^\d+(?:[.,]\d{2})$/.test(normalized) ||
    /^(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(normalized)
  ) {
    return false;
  }

  if (strength === "weak") {
    return /[A-Za-z/-]/.test(normalized);
  }

  return !/^\d{1,3}$/.test(normalized);
}

function findInvoiceNumber(
  lines: string[],
  overallConfidence: number,
): MatchCandidate<string> {
  const labeledCandidates: Array<{
    value: string;
    confidence: number;
    score: number;
  }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextLine = lines[index + 1];

    if (INVOICE_IGNORE_LINE_PATTERN.test(line)) {
      continue;
    }

    const inlineMatch = line.match(INLINE_INVOICE_LABEL_PATTERN);

    if (inlineMatch?.[1]) {
      const candidate = normalizeInvoiceNumber(inlineMatch[1]);

      if (isInvoiceNumberCandidate(candidate, "strong")) {
        labeledCandidates.push({
          value: candidate,
          confidence: scaleConfidence(overallConfidence * 0.88 + 0.08, 0.6, 0.95),
          score: 1.15,
        });
      }
    }

    if (nextLine && SPLIT_INVOICE_LABEL_PATTERN.test(line)) {
      const nextCandidate = normalizeInvoiceNumber(nextLine.split(/\s+/)[0] ?? "");

      if (
        !INVOICE_IGNORE_LINE_PATTERN.test(nextLine) &&
        isInvoiceNumberCandidate(nextCandidate, "strong")
      ) {
        labeledCandidates.push({
          value: nextCandidate,
          confidence: scaleConfidence(overallConfidence * 0.82 + 0.06, 0.52, 0.9),
          score: 0.96,
        });
      }
    }
  }

  const labeledMatch = pickBestCandidate(labeledCandidates);

  if (labeledMatch) {
    return labeledMatch;
  }

  const weakCandidates: Array<{
    value: string;
    confidence: number;
    score: number;
  }> = [];

  for (const line of lines) {
    if (INVOICE_IGNORE_LINE_PATTERN.test(line)) {
      continue;
    }

    const matches = line.match(WEAK_INVOICE_PATTERN) ?? [];

    for (const match of matches) {
      const candidate = normalizeInvoiceNumber(match);

      if (isInvoiceNumberCandidate(candidate, "weak")) {
        weakCandidates.push({
          value: candidate,
          confidence: scaleConfidence(overallConfidence * 0.48 + 0.04, 0.25, 0.64),
          score: 0.34,
        });
      }
    }
  }

  return pickBestCandidate(weakCandidates);
}

function parseAmountValue(candidate: string) {
  let normalized = candidate.replace(/[^0-9,.-]/g, "");

  if (!normalized) {
    return null;
  }

  const commaCount = (normalized.match(/,/g) ?? []).length;
  const dotCount = (normalized.match(/\./g) ?? []).length;

  if (commaCount > 0 && dotCount > 0) {
    if (normalized.lastIndexOf(",") > normalized.lastIndexOf(".")) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (commaCount > 0 && dotCount === 0) {
    normalized =
      commaCount === 1
        ? normalized.replace(",", ".")
        : normalized.replace(/,/g, "");
  }

  const amount = Number(normalized);

  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  return amount;
}

function extractAmountCandidates(line: string) {
  const matches =
    line.match(
      /(?:\$|USD|CAD|EUR|GBP)?\s*-?(?:\d{1,3}(?:[,\s]\d{3})+|\d+)(?:[.,]\d{2})?/gi,
    ) ?? [];

  return matches
    .map((match) => {
      const value = parseAmountValue(match);

      if (value === null) {
        return null;
      }

      return {
        value,
        raw: match,
        hasCurrency: /(?:\$|USD|CAD|EUR|GBP)/i.test(match),
        hasDecimals: /[.,]\d{2}\b/.test(match),
      };
    })
    .filter((token): token is AmountToken => token !== null);
}

function getPositiveAmountRule(line: string) {
  return STRONG_AMOUNT_RULES.find((rule) => rule.pattern.test(line)) ?? null;
}

function isNegativeAmountLine(line: string) {
  return (
    NEGATIVE_AMOUNT_PATTERNS.subtotal.test(line) ||
    NEGATIVE_AMOUNT_PATTERNS.tax.test(line) ||
    NEGATIVE_AMOUNT_PATTERNS.taxTotal.test(line) ||
    NEGATIVE_AMOUNT_PATTERNS.tip.test(line) ||
    NEGATIVE_AMOUNT_PATTERNS.change.test(line) ||
    NEGATIVE_AMOUNT_PATTERNS.discount.test(line) ||
    NEGATIVE_AMOUNT_PATTERNS.rounding.test(line)
  );
}

function buildAmountCandidates(
  lines: string[],
  overallConfidence: number,
): AmountCandidate[] {
  const candidates: AmountCandidate[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const positiveRule = getPositiveAmountRule(line);
    const contexts = [line];

    if (
      positiveRule &&
      index < lines.length - 1 &&
      extractAmountCandidates(line).length === 0
    ) {
      contexts.push(`${line} ${lines[index + 1]}`);
    }

    for (const context of contexts) {
      const tokens = extractAmountCandidates(context);

      if (tokens.length === 0) {
        continue;
      }

      const token = tokens[tokens.length - 1];
      let score = positiveRule?.score ?? 0.22;
      let confidence = positiveRule
        ? scaleConfidence(
            overallConfidence * positiveRule.confidence,
            0.46,
            0.97,
          )
        : scaleConfidence(overallConfidence * 0.48 + 0.05, 0.22, 0.68);

      if (token.hasDecimals) {
        score += 0.08;
        confidence = clampConfidence(confidence + 0.04);
      }

      if (token.hasCurrency) {
        score += 0.04;
      }

      if (NEGATIVE_AMOUNT_PATTERNS.subtotal.test(context)) {
        score -= 0.55;
      }

      if (NEGATIVE_AMOUNT_PATTERNS.taxTotal.test(context)) {
        score -= 0.85;
      } else if (
        NEGATIVE_AMOUNT_PATTERNS.tax.test(context) &&
        !positiveRule?.pattern.test(context)
      ) {
        score -= 0.72;
      }

      if (NEGATIVE_AMOUNT_PATTERNS.tip.test(context)) {
        score -= 0.4;
      }

      if (NEGATIVE_AMOUNT_PATTERNS.change.test(context)) {
        score -= 0.7;
      }

      if (NEGATIVE_AMOUNT_PATTERNS.tendered.test(context) && !positiveRule) {
        score -= 0.3;
      }

      if (NEGATIVE_AMOUNT_PATTERNS.discount.test(context)) {
        score -= 0.48;
      }

      if (NEGATIVE_AMOUNT_PATTERNS.rounding.test(context)) {
        score -= 0.28;
      }

      candidates.push({
        value: token.value,
        confidence,
        score,
      });
    }
  }

  return candidates;
}

function findAmount(
  lines: string[],
  overallConfidence: number,
): MatchCandidate<number> {
  const candidates = buildAmountCandidates(lines, overallConfidence);

  if (candidates.length === 0) {
    return null;
  }

  const hasStrongTotal = candidates.some((candidate) => candidate.score >= 1);
  const eligibleCandidates = candidates.filter((candidate) =>
    hasStrongTotal ? candidate.score >= 0.55 : candidate.score >= 0.18,
  );

  const bestCandidate = pickBestCandidate(
    eligibleCandidates.length > 0 ? eligibleCandidates : candidates,
  );

  return bestCandidate;
}

export function createEmptyOcrResult(provider: string): OcrResult {
  return {
    invoiceNumber: "",
    invoiceDate: "",
    amount: 0,
    provider,
    confidence: {
      invoiceNumber: 0,
      invoiceDate: 0,
      amount: 0,
    },
  };
}

export function parseInvoiceFieldsFromText(
  rawText: string,
  provider: string,
  overallConfidence: number,
): OcrResult {
  const lines = normalizeLines(rawText);
  const baseConfidence = clampConfidence(
    overallConfidence > 1 ? overallConfidence / 100 : overallConfidence,
  );
  const invoiceNumber = findInvoiceNumber(lines, baseConfidence);
  const invoiceDate = findInvoiceDate(lines, baseConfidence);
  const amount = findAmount(lines, baseConfidence);

  return {
    invoiceNumber: invoiceNumber?.value ?? "",
    invoiceDate: invoiceDate?.value ?? "",
    amount: amount?.value ?? 0,
    provider,
    confidence: {
      invoiceNumber: invoiceNumber?.confidence ?? 0,
      invoiceDate: invoiceDate?.confidence ?? 0,
      amount: amount?.confidence ?? 0,
    },
  };
}

export function hasAnyOcrField(result: Pick<OcrResult, "confidence">) {
  return (
    result.confidence.invoiceNumber > 0 ||
    result.confidence.invoiceDate > 0 ||
    result.confidence.amount > 0
  );
}

export function hasStrongOcrMatch(result: Pick<OcrResult, "confidence">) {
  return (
    result.confidence.invoiceNumber >= 0.6 &&
    result.confidence.invoiceDate >= 0.6 &&
    result.confidence.amount >= 0.6
  );
}
