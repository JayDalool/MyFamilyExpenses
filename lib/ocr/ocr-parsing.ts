import type { OcrConfidence, OcrResult } from "@/lib/ocr/types";

type MatchCandidate<T> = {
  value: T;
  confidence: number;
} | null;

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

const AMOUNT_KEYWORDS = [
  { pattern: /grand\s+total/i, confidence: 0.92 },
  { pattern: /amount\s+due/i, confidence: 0.9 },
  { pattern: /total\s+due/i, confidence: 0.88 },
  { pattern: /balance\s+due/i, confidence: 0.88 },
  { pattern: /invoice\s+total/i, confidence: 0.86 },
  { pattern: /total/i, confidence: 0.72 },
  { pattern: /amount/i, confidence: 0.62 },
];

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

function parseNamedMonthDate(value: string) {
  const monthFirst = value.match(
    /\b([A-Za-z]{3,9})\s+(\d{1,2})(?:,)?\s+((?:19|20)\d{2})\b/i,
  );

  if (monthFirst) {
    const month = MONTH_NAMES[monthFirst[1].toLowerCase()];
    const day = Number(monthFirst[2]);
    const year = Number(monthFirst[3]);
    return month ? toIsoDate(year, month, day) : null;
  }

  const dayFirst = value.match(
    /\b(\d{1,2})\s+([A-Za-z]{3,9})(?:,)?\s+((?:19|20)\d{2})\b/i,
  );

  if (!dayFirst) {
    return null;
  }

  const month = MONTH_NAMES[dayFirst[2].toLowerCase()];
  const day = Number(dayFirst[1]);
  const year = Number(dayFirst[3]);

  return month ? toIsoDate(year, month, day) : null;
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

  const monthDayYear = value.match(
    /\b(\d{1,2})[-/.](\d{1,2})[-/.]((?:19|20)\d{2})\b/,
  );

  if (!monthDayYear) {
    return null;
  }

  const first = Number(monthDayYear[1]);
  const second = Number(monthDayYear[2]);
  const year = Number(monthDayYear[3]);

  if (first > 12 && second <= 12) {
    return toIsoDate(year, second, first);
  }

  if (second > 12 && first <= 12) {
    return toIsoDate(year, first, second);
  }

  return toIsoDate(year, first, second);
}

function parseDateValue(value: string) {
  return parseNumericDate(value) ?? parseNamedMonthDate(value);
}

function findInvoiceDate(lines: string[], overallConfidence: number): MatchCandidate<string> {
  for (const line of lines) {
    if (!/\bdate\b/i.test(line)) {
      continue;
    }

    const parsed = parseDateValue(line);

    if (parsed) {
      return {
        value: parsed,
        confidence: scaleConfidence(overallConfidence * 0.85 + 0.15, 0.58, 0.95),
      };
    }
  }

  for (const line of lines) {
    const parsed = parseDateValue(line);

    if (parsed) {
      return {
        value: parsed,
        confidence: scaleConfidence(overallConfidence * 0.55 + 0.05, 0.3, 0.72),
      };
    }
  }

  return null;
}

function normalizeInvoiceNumber(candidate: string) {
  return candidate.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9/.-]+$/g, "");
}

function isInvoiceNumberCandidate(candidate: string) {
  return (
    candidate.length >= 3 &&
    candidate.length <= 32 &&
    /\d/.test(candidate) &&
    !/^\d+(?:[.,]\d{2})$/.test(candidate) &&
    !/^(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(candidate)
  );
}

function findInvoiceNumber(
  lines: string[],
  overallConfidence: number,
): MatchCandidate<string> {
  const keywordPatterns = [
    /(?:invoice|receipt|bill)\s*(?:no|#|number|num)?\s*[:#-]?\s*([A-Za-z0-9/.-]+)/i,
    /(?:ref(?:erence)?|order)\s*(?:no|#|number|num)?\s*[:#-]?\s*([A-Za-z0-9/.-]+)/i,
  ];

  for (const line of lines) {
    for (const pattern of keywordPatterns) {
      const match = line.match(pattern);

      if (!match?.[1]) {
        continue;
      }

      const candidate = normalizeInvoiceNumber(match[1]);

      if (isInvoiceNumberCandidate(candidate)) {
        return {
          value: candidate,
          confidence: scaleConfidence(overallConfidence * 0.85 + 0.12, 0.55, 0.93),
        };
      }
    }
  }

  for (const line of lines) {
    const matches = line.match(/\b[A-Za-z0-9/.-]*\d[A-Za-z0-9/.-]*\b/g) ?? [];

    for (const match of matches) {
      const candidate = normalizeInvoiceNumber(match);

      if (isInvoiceNumberCandidate(candidate)) {
        return {
          value: candidate,
          confidence: scaleConfidence(overallConfidence * 0.45 + 0.05, 0.24, 0.62),
        };
      }
    }
  }

  return null;
}

function parseAmountValue(candidate: string) {
  let normalized = candidate.replace(/[^\d,.-]/g, "");

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
    normalized = commaCount === 1 ? normalized.replace(",", ".") : normalized.replace(/,/g, "");
  }

  const amount = Number(normalized);

  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  return amount;
}

function extractAmountCandidates(line: string) {
  const matches =
    line.match(/(?:[$€£]|USD|CAD|EUR|GBP)?\s*\d[\d,]*(?:[.,]\d{2})?/gi) ?? [];

  return matches
    .map((match) => parseAmountValue(match))
    .filter((value): value is number => value !== null);
}

function findAmount(lines: string[], overallConfidence: number): MatchCandidate<number> {
  for (const { pattern, confidence } of AMOUNT_KEYWORDS) {
    for (const line of lines) {
      if (!pattern.test(line)) {
        continue;
      }

      const candidates = extractAmountCandidates(line);

      if (candidates.length > 0) {
        return {
          value: candidates[candidates.length - 1],
          confidence: scaleConfidence(overallConfidence * confidence, 0.48, 0.96),
        };
      }
    }
  }

  const allCandidates = lines.flatMap((line) => extractAmountCandidates(line));

  if (allCandidates.length === 0) {
    return null;
  }

  return {
    value: Math.max(...allCandidates),
    confidence: scaleConfidence(overallConfidence * 0.5 + 0.05, 0.22, 0.64),
  };
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
