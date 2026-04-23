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

type ReceiptContext = {
  hasCanadianMarkers: boolean;
  hasCardPaymentMarkers: boolean;
};

type DateParseOptions = {
  hasDateLabel: boolean;
  preferDayFirst: boolean;
  overallConfidence: number;
};

type InvoiceLabelRule = {
  pattern: RegExp;
  score: number;
  confidence: number;
  strength: "strong" | "weak";
  contextGuard?: "payment" | "store";
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
  /\bdate\s*\/\s*time\b/i,
  /\btime\s*\/\s*date\b/i,
  /\bdate\b/i,
  /\bdated\b/i,
  /\bpurchase\s+date\b/i,
  /\btransaction\s+date\b/i,
  /\btrans\s+date\b/i,
  /\btxn\s+date\b/i,
  /\binvoice\s+date\b/i,
  /\border\s+date\b/i,
  /\breceipt\s+date\b/i,
  /\bsale\s+date\b/i,
  /\bdate\s+time\b/i,
  /\bissued\b/i,
];

const CANADIAN_RECEIPT_PATTERN =
  /\b(?:gst|hst|pst|qst|interac|debit|visa|mastercard|amex|cad|canada)\b/i;

const CARD_PAYMENT_PATTERN =
  /\b(?:debit|visa|mastercard|interac|amex)\b/i;

const STRONG_AMOUNT_RULES = [
  { pattern: /\bgrand\s+total\b/i, score: 1.35, confidence: 0.96 },
  { pattern: /\bamount\s+paid\b/i, score: 1.28, confidence: 0.95 },
  { pattern: /\btotal\s+paid\b/i, score: 1.24, confidence: 0.94 },
  { pattern: /\bpayment\s+total\b/i, score: 1.18, confidence: 0.93 },
  { pattern: /\bamount\s+due\b/i, score: 1.16, confidence: 0.92 },
  { pattern: /\bbalance\s+due\b/i, score: 1.15, confidence: 0.92 },
  { pattern: /\btotal\s+due\b/i, score: 1.12, confidence: 0.91 },
  { pattern: /\binvoice\s+total\b/i, score: 1.08, confidence: 0.9 },
  { pattern: /\bamount\b/i, score: 0.74, confidence: 0.72 },
  { pattern: /(?:^|\b)total(?:\b|$)/i, score: 0.98, confidence: 0.84 },
  { pattern: /\binterac\b/i, score: 0.7, confidence: 0.76 },
  { pattern: /\bdebit\b/i, score: 0.68, confidence: 0.74 },
  { pattern: /\bvisa\b/i, score: 0.66, confidence: 0.73 },
  { pattern: /\bmastercard\b/i, score: 0.66, confidence: 0.73 },
  { pattern: /\bamex\b/i, score: 0.64, confidence: 0.72 },
];

const NEGATIVE_AMOUNT_PATTERNS = {
  subtotal: /\bsub[\s-]?total\b/i,
  tax: /\b(?:tax|gst|pst|hst|qst|vat|iva)\b/i,
  taxTotal: /\b(?:tax\s+total|total\s+tax)\b/i,
  tip: /\btip\b/i,
  change: /\bchange\b/i,
  tendered: /\b(?:cash|tender(?:ed)?|paid\s+out)\b/i,
  discount: /\b(?:discount|savings?)\b/i,
  rounding: /\bround(?:ing)?\b/i,
  auth: /\b(?:authorization|authorisation|approval|auth(?:\s*code)?|trace|rrn|stan)\b/i,
};

const INVOICE_LABEL_RULES: InvoiceLabelRule[] = [
  {
    pattern:
      /\brcpt\s*(?:#|no\.?|number|num|id)?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9/.-]{2,31})\b/i,
    score: 1.2,
    confidence: 0.93,
    strength: "strong",
  },
  {
    pattern:
      /\breceipt\s*(?:#|no\.?|number|num|id)?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9/.-]{2,31})\b/i,
    score: 1.22,
    confidence: 0.94,
    strength: "strong",
  },
  {
    pattern:
      /\binvoice\s*(?:#|no\.?|number|num|id)?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9/.-]{2,31})\b/i,
    score: 1.18,
    confidence: 0.93,
    strength: "strong",
  },
  {
    pattern:
      /\binv\s*(?:#|no\.?|number|num|id)?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9/.-]{2,31})\b/i,
    score: 1.12,
    confidence: 0.9,
    strength: "strong",
  },
  {
    pattern:
      /\b(?:transaction|trans|txn|trn)(?!\s+date)\s*(?:#|no\.?|number|num|id)?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9/.-]{2,31})\b/i,
    score: 1.15,
    confidence: 0.92,
    strength: "strong",
  },
  {
    pattern:
      /\border\s*(?:#|no\.?|number|num|id)?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9/.-]{2,31})\b/i,
    score: 1.08,
    confidence: 0.9,
    strength: "strong",
  },
  {
    pattern:
      /\bref(?:erence)?\s*(?:#|no\.?|number|num|id)?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9/.-]{2,31})\b/i,
    score: 0.98,
    confidence: 0.86,
    strength: "strong",
    contextGuard: "payment",
  },
  {
    pattern:
      /\b(?:check|cheque)\s*(?:#|no\.?|number|num|id)?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9/.-]{2,31})\b/i,
    score: 0.95,
    confidence: 0.84,
    strength: "strong",
  },
  {
    pattern:
      /\bbill\s*(?:#|no\.?|number|num|id)?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9/.-]{2,31})\b/i,
    score: 0.92,
    confidence: 0.82,
    strength: "strong",
  },
  {
    pattern:
      /\bseq(?:uence)?\s*(?:#|no\.?|number|num|id)?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9/.-]{2,31})\b/i,
    score: 0.9,
    confidence: 0.8,
    strength: "strong",
  },
  {
    pattern:
      /\bsale\s*(?:#|no\.?|number|num|id)?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9/.-]{2,31})\b/i,
    score: 0.82,
    confidence: 0.78,
    strength: "strong",
  },
  {
    pattern:
      /\breg\s*(?:#|no\.?|number|num|id)?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9/.-]{2,31})\b/i,
    score: 0.58,
    confidence: 0.58,
    strength: "weak",
    contextGuard: "store",
  },
];

const SPLIT_INVOICE_LABEL_RULES: InvoiceLabelRule[] = [
  { pattern: /\brcpt\s*(?:#|no\.?|number|num|id)?\b/i, score: 1.08, confidence: 0.9, strength: "strong" },
  { pattern: /\breceipt\s*(?:#|no\.?|number|num|id)?\b/i, score: 1.08, confidence: 0.9, strength: "strong" },
  { pattern: /\binvoice\s*(?:#|no\.?|number|num|id)?\b/i, score: 1.04, confidence: 0.88, strength: "strong" },
  { pattern: /\binv\s*(?:#|no\.?|number|num|id)?\b/i, score: 1, confidence: 0.85, strength: "strong" },
  { pattern: /\b(?:transaction|trans|txn|trn)(?!\s+date)\s*(?:#|no\.?|number|num|id)?\b/i, score: 1.02, confidence: 0.87, strength: "strong" },
  { pattern: /\border\s*(?:#|no\.?|number|num|id)?\b/i, score: 0.94, confidence: 0.84, strength: "strong" },
  { pattern: /\bref(?:erence)?\s*(?:#|no\.?|number|num|id)?\b/i, score: 0.86, confidence: 0.8, strength: "strong", contextGuard: "payment" },
  { pattern: /\b(?:check|cheque)\s*(?:#|no\.?|number|num|id)?\b/i, score: 0.82, confidence: 0.78, strength: "strong" },
  { pattern: /\bbill\s*(?:#|no\.?|number|num|id)?\b/i, score: 0.78, confidence: 0.76, strength: "strong" },
  { pattern: /\bseq(?:uence)?\s*(?:#|no\.?|number|num|id)?\b/i, score: 0.74, confidence: 0.74, strength: "strong" },
  { pattern: /\bsale\s*(?:#|no\.?|number|num|id)?\b/i, score: 0.72, confidence: 0.72, strength: "strong" },
  { pattern: /\breg\s*(?:#|no\.?|number|num|id)?\b/i, score: 0.48, confidence: 0.54, strength: "weak", contextGuard: "store" },
];

const WEAK_INVOICE_IGNORE_LINE_PATTERN =
  /\b(?:phone|tel|telephone|fax|mobile|customer\s+service|store\s*(?:#|no|number)?|location|branch|terminal(?:\s+id)?|term\s*id|merchant|cashier|clerk|server|table|gst|hst|pst|qst|bn|business\s+number|authorization|authorisation|approval|auth(?:\s*code)?|trace|rrn|stan|mid|tid|aid)\b/i;

const PAYMENT_REFERENCE_CONTEXT_PATTERN =
  /\b(?:authorization|authorisation|approval|auth(?:\s*code)?|trace|rrn|stan|merchant|card|visa|mastercard|amex|interac|debit|mid|tid|aid)\b/i;

const STORE_TERMINAL_CONTEXT_PATTERN =
  /\b(?:store|branch|location|terminal|register)\b/i;

const PHONE_PATTERN =
  /(?:\+?\d{1,2}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/;

const CANADIAN_POSTAL_CODE_PATTERN =
  /\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d\b/i;

const TAX_IDENTIFIER_PATTERN = /^\d{9}(?:RT\d{4})?$/i;

const WEAK_INVOICE_PATTERN =
  /\b(?:[A-Za-z]{1,8}[-/]?\d{3,}[A-Za-z0-9/-]*|\d{3,}[A-Za-z]{1,8}[A-Za-z0-9/-]*)\b/g;

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

function buildReceiptContext(lines: string[]): ReceiptContext {
  const joinedText = lines.join(" ");

  return {
    hasCanadianMarkers: CANADIAN_RECEIPT_PATTERN.test(joinedText),
    hasCardPaymentMarkers: CARD_PAYMENT_PATTERN.test(joinedText),
  };
}

function getReceiptDateRealismScore(value: string) {
  const date = new Date(`${value}T12:00:00Z`);

  if (Number.isNaN(date.getTime())) {
    return -0.75;
  }

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const year = date.getUTCFullYear();

  if (year < 2000 || year > currentYear + 1) {
    return -0.75;
  }

  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const daysDiff = Math.round((date.getTime() - today) / 86_400_000);
  let score = 0;

  if (daysDiff > 60) {
    score -= 0.24;
  } else if (daysDiff > 21) {
    score -= 0.08;
  } else {
    score += 0.04;
  }

  if (daysDiff < -3650) {
    score -= 0.08;
  }

  if (daysDiff < -7300) {
    score -= 0.14;
  }

  return score;
}

function normalizeDateSourceText(value: string) {
  let normalized = value.replace(/\b([A-Za-z]{3,9})\.(?=[\s/-]|\d)/g, "$1");

  normalized = normalized.replace(/(\d)\s*([./-])\s*(\d)/g, "$1$2$3");
  normalized = normalized.replace(/([./-])\s+(\d)/g, "$1$2");
  normalized = normalized.replace(/(\d)\s+([./-])/g, "$1$2");
  normalized = normalized.replace(
    /(^|[\s./-])[Oo](?=\d)/g,
    (match, prefix: string) => `${prefix}0`,
  );
  normalized = normalized.replace(
    /(\d)[Oo](?=\d)/g,
    (match, digit: string) => `${digit}0`,
  );
  normalized = normalized.replace(
    /(\d)[Oo](?=[\s./-]\d)/g,
    (match, digit: string) => `${digit}0`,
  );
  normalized = normalized.replace(
    /(^|[\s./-])[Il](?=\d)/g,
    (match, prefix: string) => `${prefix}1`,
  );
  normalized = normalized.replace(
    /(\d)[Il](?=\d)/g,
    (match, digit: string) => `${digit}1`,
  );
  normalized = normalized.replace(
    /(\d)[Il](?=[\s./-]\d)/g,
    (match, digit: string) => `${digit}1`,
  );

  return normalized;
}

function buildDateCandidate(
  value: string,
  options: DateParseOptions,
  baseScore: number,
  ambiguityPenalty = 0,
): DateCandidate | null {
  const realismScore = getReceiptDateRealismScore(value);

  if (realismScore <= -0.7) {
    return null;
  }

  const confidenceWeight = options.hasDateLabel ? 0.82 : 0.6;
  const confidenceBonus = options.hasDateLabel ? 0.12 : 0.04;

  return {
    value,
    score: baseScore + realismScore - ambiguityPenalty,
    confidence: scaleConfidence(
      options.overallConfidence * confidenceWeight +
        confidenceBonus -
        ambiguityPenalty * 0.22,
      options.hasDateLabel ? 0.58 : 0.28,
      options.hasDateLabel ? 0.97 : 0.84,
    ),
  };
}

function pushDateCandidate(
  candidates: DateCandidate[],
  isoDate: string | null,
  options: DateParseOptions,
  baseScore: number,
  ambiguityPenalty = 0,
) {
  if (!isoDate) {
    return;
  }

  const candidate = buildDateCandidate(
    isoDate,
    options,
    baseScore,
    ambiguityPenalty,
  );

  if (candidate) {
    candidates.push(candidate);
  }
}

function extractNamedMonthDateCandidates(
  value: string,
  options: DateParseOptions,
  candidates: DateCandidate[],
) {
  const monthFirstPattern =
    /\b([A-Za-z]{3,9})[\s/-]+(\d{1,2})(?:,)?[\s/-]+((?:19|20)?\d{2})\b/gi;

  for (const match of value.matchAll(monthFirstPattern)) {
    const month = MONTH_NAMES[match[1].toLowerCase()];
    const day = Number(match[2]);
    const year = normalizeYear(Number(match[3]));

    pushDateCandidate(
      candidates,
      month ? toIsoDate(year, month, day) : null,
      options,
      options.hasDateLabel ? 1.02 : 0.68,
    );
  }

  const dayFirstPattern =
    /\b(\d{1,2})[\s/-]+([A-Za-z]{3,9})(?:,)?[\s/-]+((?:19|20)?\d{2})\b/gi;

  for (const match of value.matchAll(dayFirstPattern)) {
    const month = MONTH_NAMES[match[2].toLowerCase()];
    const day = Number(match[1]);
    const year = normalizeYear(Number(match[3]));

    pushDateCandidate(
      candidates,
      month ? toIsoDate(year, month, day) : null,
      options,
      options.hasDateLabel ? 1.02 : 0.68,
    );
  }
}

function extractSpacedNumericDateCandidates(
  value: string,
  options: DateParseOptions,
  candidates: DateCandidate[],
) {
  if (!options.hasDateLabel) {
    return;
  }

  const yearFirstPattern = /\b((?:19|20)\d{2})\s+(\d{1,2})\s+(\d{1,2})\b/g;

  for (const match of value.matchAll(yearFirstPattern)) {
    pushDateCandidate(
      candidates,
      toIsoDate(Number(match[1]), Number(match[2]), Number(match[3])),
      options,
      1,
    );
  }

  const dayMonthPattern = /\b(\d{1,2})\s+(\d{1,2})\s+((?:19|20)?\d{2})\b/g;

  for (const match of value.matchAll(dayMonthPattern)) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = normalizeYear(Number(match[3]));

    if (first > 31 || second > 31 || (first <= 12 && second <= 12)) {
      continue;
    }

    if (first > 12 && second <= 12) {
      pushDateCandidate(
        candidates,
        toIsoDate(year, second, first),
        options,
        0.96,
      );
      continue;
    }

    if (second > 12 && first <= 12) {
      pushDateCandidate(
        candidates,
        toIsoDate(year, first, second),
        options,
        0.92,
      );
    }
  }
}

function extractCompactDateCandidates(
  value: string,
  options: DateParseOptions,
  candidates: DateCandidate[],
) {
  const compactPattern = /\b((?:19|20)\d{2})(\d{2})(\d{2})\b/g;

  for (const match of value.matchAll(compactPattern)) {
    pushDateCandidate(
      candidates,
      toIsoDate(Number(match[1]), Number(match[2]), Number(match[3])),
      options,
      options.hasDateLabel ? 0.92 : 0.52,
    );
  }
}

function extractYearFirstDateCandidates(
  value: string,
  options: DateParseOptions,
  candidates: DateCandidate[],
) {
  const yearFirstPattern = /\b((?:19|20)\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g;

  for (const match of value.matchAll(yearFirstPattern)) {
    pushDateCandidate(
      candidates,
      toIsoDate(Number(match[1]), Number(match[2]), Number(match[3])),
      options,
      options.hasDateLabel ? 1.06 : 0.7,
    );
  }
}

function extractSlashDateCandidates(
  value: string,
  options: DateParseOptions,
  candidates: DateCandidate[],
) {
  const numericPattern = /\b(\d{1,2})([-/.])(\d{1,2})\2((?:19|20)?\d{2})\b/g;

  for (const match of value.matchAll(numericPattern)) {
    const first = Number(match[1]);
    const separator = match[2];
    const second = Number(match[3]);
    const year = normalizeYear(Number(match[4]));

    if (first > 31 || second > 31) {
      continue;
    }

    if (first > 12 && second <= 12) {
      pushDateCandidate(
        candidates,
        toIsoDate(year, second, first),
        options,
        options.hasDateLabel ? 1.04 : 0.66,
      );
      continue;
    }

    if (second > 12 && first <= 12) {
      pushDateCandidate(
        candidates,
        toIsoDate(year, first, second),
        options,
        options.hasDateLabel ? 1.02 : 0.64,
      );
      continue;
    }

    if (first > 12 || second > 12) {
      continue;
    }

    const preferDayFirst = separator === "." || options.preferDayFirst;
    const dayFirstBase = options.hasDateLabel
      ? preferDayFirst
        ? 0.98
        : 0.84
      : preferDayFirst
        ? 0.6
        : 0.48;
    const monthFirstBase = options.hasDateLabel
      ? preferDayFirst
        ? 0.84
        : 0.98
      : preferDayFirst
        ? 0.48
        : 0.6;

    pushDateCandidate(
      candidates,
      toIsoDate(year, second, first),
      options,
      dayFirstBase,
      0.08,
    );
    pushDateCandidate(
      candidates,
      toIsoDate(year, first, second),
      options,
      monthFirstBase,
      0.08,
    );
  }
}

function dedupeDateCandidates(candidates: DateCandidate[]) {
  const byValue = new Map<string, DateCandidate>();

  for (const candidate of candidates) {
    const existing = byValue.get(candidate.value);

    if (
      !existing ||
      candidate.score > existing.score ||
      (candidate.score === existing.score &&
        candidate.confidence > existing.confidence)
    ) {
      byValue.set(candidate.value, candidate);
    }
  }

  return Array.from(byValue.values());
}

function extractDateCandidatesFromText(
  value: string,
  options: DateParseOptions,
) {
  const normalizedValue = normalizeDateSourceText(value);
  const candidates: DateCandidate[] = [];

  extractYearFirstDateCandidates(normalizedValue, options, candidates);
  extractSlashDateCandidates(normalizedValue, options, candidates);
  extractNamedMonthDateCandidates(normalizedValue, options, candidates);
  extractSpacedNumericDateCandidates(normalizedValue, options, candidates);
  extractCompactDateCandidates(normalizedValue, options, candidates);

  return dedupeDateCandidates(candidates);
}

function getDateLinePositionBonus(index: number, totalLines: number) {
  if (totalLines <= 1) {
    return 0;
  }

  const position = index / (totalLines - 1);

  if (position <= 0.2) {
    return 0.08;
  }

  if (position <= 0.45) {
    return 0.04;
  }

  return 0;
}

function shouldPreferDayFirst(
  text: string,
  hasDateLabel: boolean,
  context: ReceiptContext,
) {
  if (/\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/.test(text)) {
    return true;
  }

  if (CANADIAN_RECEIPT_PATTERN.test(text)) {
    return true;
  }

  return context.hasCanadianMarkers && hasDateLabel;
}

function findInvoiceDate(
  lines: string[],
  overallConfidence: number,
  context: ReceiptContext,
): MatchCandidate<string> {
  const candidates: DateCandidate[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextLine = lines[index + 1];
    const hasDateLabel = DATE_LABEL_PATTERNS.some((pattern) => pattern.test(line));
    const contexts = [line];
    const linePositionBonus = getDateLinePositionBonus(index, lines.length);

    if (hasDateLabel && nextLine) {
      contexts.push(`${line} ${nextLine}`);
    }

    for (const text of contexts) {
      const parsedCandidates = extractDateCandidatesFromText(text, {
        hasDateLabel,
        preferDayFirst: shouldPreferDayFirst(text, hasDateLabel, context),
        overallConfidence,
      }).map((candidate) => ({
        ...candidate,
        score: candidate.score + linePositionBonus,
      }));

      candidates.push(...parsedCandidates);
    }
  }

  return pickBestCandidate(dedupeDateCandidates(candidates));
}

function normalizeInvoiceNumber(candidate: string) {
  return candidate.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9/.-]+$/g, "");
}

function looksLikePhoneNumber(candidate: string) {
  const digitsOnly = candidate.replace(/\D/g, "");

  if (/[()+\s-]/.test(candidate)) {
    return PHONE_PATTERN.test(candidate);
  }

  return digitsOnly.length === 10 && /^[2-9]\d{9}$/.test(digitsOnly);
}

function isLikelyDateValue(candidate: string) {
  return (
    /^(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(candidate) ||
    /^\d{1,2}[-/.]\d{1,2}[-/.](?:19|20)?\d{2}$/.test(candidate)
  );
}

function isLikelyAmountValue(candidate: string) {
  return /^\d+(?:[.,]\d{2})$/.test(candidate);
}

function isInvoiceNumberCandidate(
  candidate: string,
  strength: "strong" | "weak",
  line: string,
) {
  const normalized = normalizeInvoiceNumber(candidate);
  const phoneLike = looksLikePhoneNumber(normalized);

  if (
    normalized.length < 3 ||
    normalized.length > 32 ||
    !/\d/.test(normalized) ||
    (phoneLike && strength === "weak") ||
    CANADIAN_POSTAL_CODE_PATTERN.test(normalized) ||
    isLikelyAmountValue(normalized) ||
    isLikelyDateValue(normalized)
  ) {
    return false;
  }

  if (phoneLike && /[()+\s-]/.test(candidate)) {
    return false;
  }

  if (
    TAX_IDENTIFIER_PATTERN.test(normalized) &&
    (strength === "weak" ||
      /\b(?:gst|hst|pst|qst|tax|business\s+number|bn)\b/i.test(line))
  ) {
    return false;
  }

  if (
    strength === "weak" &&
    WEAK_INVOICE_IGNORE_LINE_PATTERN.test(line)
  ) {
    return false;
  }

  if (strength === "weak") {
    return /[A-Za-z/-]/.test(normalized);
  }

  return !/^\d{1,2}$/.test(normalized);
}

function extractSplitInvoiceCandidate(line: string) {
  const normalizedLine = line
    .replace(/^(?:#|no\.?|number|num|id)\s*[:#-]?\s*/i, "")
    .trim();
  const matches =
    normalizedLine.match(/[A-Za-z0-9][A-Za-z0-9/.-]{2,31}/g) ?? [];

  for (const match of matches) {
    if (/\d/.test(match)) {
      return normalizeInvoiceNumber(match);
    }
  }

  return normalizeInvoiceNumber(matches[0] ?? "");
}

function passesInvoiceRuleContext(rule: InvoiceLabelRule, line: string) {
  if (rule.contextGuard === "payment") {
    return !PAYMENT_REFERENCE_CONTEXT_PATTERN.test(line);
  }

  if (rule.contextGuard === "store") {
    return !STORE_TERMINAL_CONTEXT_PATTERN.test(line);
  }

  return true;
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

    for (const rule of INVOICE_LABEL_RULES) {
      if (!passesInvoiceRuleContext(rule, line)) {
        continue;
      }

      const inlineMatch = line.match(rule.pattern);

      if (!inlineMatch?.[1]) {
        continue;
      }

      const candidate = normalizeInvoiceNumber(inlineMatch[1]);

      if (!isInvoiceNumberCandidate(candidate, rule.strength, line)) {
        continue;
      }

      labeledCandidates.push({
        value: candidate,
        confidence: scaleConfidence(
          overallConfidence * rule.confidence,
          rule.strength === "strong" ? 0.6 : 0.44,
          0.96,
        ),
        score: rule.score,
      });
    }

    if (!nextLine) {
      continue;
    }

    for (const rule of SPLIT_INVOICE_LABEL_RULES) {
      if (!passesInvoiceRuleContext(rule, `${line} ${nextLine}`)) {
        continue;
      }

      if (!rule.pattern.test(line)) {
        continue;
      }

       const inlineLineCandidate = extractSplitInvoiceCandidate(line);

      if (isInvoiceNumberCandidate(inlineLineCandidate, rule.strength, line)) {
        continue;
      }

      const nextCandidate = extractSplitInvoiceCandidate(nextLine);

      if (!isInvoiceNumberCandidate(nextCandidate, rule.strength, nextLine)) {
        continue;
      }

      labeledCandidates.push({
        value: nextCandidate,
        confidence: scaleConfidence(
          overallConfidence * rule.confidence,
          rule.strength === "strong" ? 0.54 : 0.4,
          0.92,
        ),
        score: rule.score,
      });
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
    if (WEAK_INVOICE_IGNORE_LINE_PATTERN.test(line)) {
      continue;
    }

    const matches = line.match(WEAK_INVOICE_PATTERN) ?? [];

    for (const match of matches) {
      const candidate = normalizeInvoiceNumber(match);

      if (isInvoiceNumberCandidate(candidate, "weak", line)) {
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

function buildAmountCandidates(
  lines: string[],
  overallConfidence: number,
  context: ReceiptContext,
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

    for (const contextLine of contexts) {
      const tokens = extractAmountCandidates(contextLine);

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

      if (
        context.hasCardPaymentMarkers &&
        CARD_PAYMENT_PATTERN.test(contextLine) &&
        !NEGATIVE_AMOUNT_PATTERNS.auth.test(contextLine)
      ) {
        score += 0.05;
      }

      if (NEGATIVE_AMOUNT_PATTERNS.subtotal.test(contextLine)) {
        score -= 0.55;
      }

      if (NEGATIVE_AMOUNT_PATTERNS.taxTotal.test(contextLine)) {
        score -= 0.85;
      } else if (
        NEGATIVE_AMOUNT_PATTERNS.tax.test(contextLine) &&
        !positiveRule?.pattern.test(contextLine)
      ) {
        score -= 0.72;
      }

      if (NEGATIVE_AMOUNT_PATTERNS.tip.test(contextLine)) {
        score -= 0.4;
      }

      if (NEGATIVE_AMOUNT_PATTERNS.change.test(contextLine)) {
        score -= 0.7;
      }

      if (NEGATIVE_AMOUNT_PATTERNS.tendered.test(contextLine) && !positiveRule) {
        score -= 0.3;
      }

      if (NEGATIVE_AMOUNT_PATTERNS.discount.test(contextLine)) {
        score -= 0.48;
      }

      if (NEGATIVE_AMOUNT_PATTERNS.rounding.test(contextLine)) {
        score -= 0.28;
      }

      if (NEGATIVE_AMOUNT_PATTERNS.auth.test(contextLine)) {
        score -= 0.72;
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
  context: ReceiptContext,
): MatchCandidate<number> {
  const candidates = buildAmountCandidates(lines, overallConfidence, context);

  if (candidates.length === 0) {
    return null;
  }

  const hasStrongTotal = candidates.some((candidate) => candidate.score >= 1);
  const eligibleCandidates = candidates.filter((candidate) =>
    hasStrongTotal ? candidate.score >= 0.55 : candidate.score >= 0.18,
  );

  return pickBestCandidate(
    eligibleCandidates.length > 0 ? eligibleCandidates : candidates,
  );
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
  const context = buildReceiptContext(lines);
  const invoiceNumber = findInvoiceNumber(lines, baseConfidence);
  const invoiceDate = findInvoiceDate(lines, baseConfidence, context);
  const amount = findAmount(lines, baseConfidence, context);

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
