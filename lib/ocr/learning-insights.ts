import { prisma } from "@/lib/db/prisma";

// Phase D.1: OCR learning insights. Read-only analytics derived from
// ReceiptCorrectionFeedback. The summarize core is PURE (no DB, no I/O) so its
// privacy and math are unit-testable. It exposes ONLY derived fields — never raw
// OCR text, blocks, or card/account numbers (the feedback table stores none of
// those, and examples deliberately omit invoice/reference strings too).

// ── Input record (decoupled from Prisma; Decimals already converted) ──────────
export type FeedbackRecord = {
  receiptType: string;
  merchantGuess: string | null;
  provider: string;
  strategy: string;
  parserVersion: string;
  invoiceNumberChanged: boolean;
  invoiceDateChanged: boolean;
  amountChanged: boolean;
  predictedAmount: number | null;
  finalAmount: number;
  predictedInvoiceDate: string | null;
  finalInvoiceDate: string | null;
  amountConfidence: number | null;
  createdAt: string; // ISO timestamp
};

export type CorrectionRate = { changed: number; total: number; rate: number };

export type MerchantStat = {
  merchant: string;
  total: number;
  amountChanged: number;
  dateChanged: number;
  invoiceChanged: number;
  correctionCount: number;
  amountChangeRate: number;
};

export type ReceiptTypeStat = {
  receiptType: string;
  total: number;
  amountChanged: number;
  dateChanged: number;
  invoiceChanged: number;
  correctionCount: number;
  amountChangeRate: number;
  invoiceChangeRate: number;
};

export type ProviderStat = {
  key: string;
  provider: string;
  strategy: string;
  total: number;
  amountChangeRate: number;
  dateChangeRate: number;
  invoiceChangeRate: number;
};

// Privacy allowlist: an example carries amounts/dates (the household's own data,
// already visible in reports), the redacted merchant guess, the receipt type, and
// boolean change flags. It NEVER carries invoice/reference strings (those came
// from unredacted parser output) or any raw OCR text.
export type FeedbackExample = {
  createdAt: string;
  merchantGuess: string | null;
  receiptType: string;
  provider: string;
  predictedAmount: number | null;
  finalAmount: number;
  amountChanged: boolean;
  predictedInvoiceDate: string | null;
  finalInvoiceDate: string | null;
  invoiceDateChanged: boolean;
  invoiceNumberChanged: boolean;
};

export type LearningInsights = {
  totalRecords: number;
  amountCorrectionRate: CorrectionRate;
  dateCorrectionRate: CorrectionRate;
  invoiceCorrectionRate: CorrectionRate;
  merchants: MerchantStat[];
  receiptTypes: ReceiptTypeStat[];
  providerPerformance: ProviderStat[];
  recentExamples: FeedbackExample[];
  correctExamples: FeedbackExample[];
  correctedExamples: FeedbackExample[];
};

const EXAMPLE_LIMIT = 10;
const SUB_EXAMPLE_LIMIT = 5;

const rate = (changed: number, total: number): CorrectionRate => ({
  changed,
  total,
  rate: total === 0 ? 0 : changed / total,
});

const ratio = (part: number, total: number): number => (total === 0 ? 0 : part / total);

// Build the privacy-allowlisted example projection. Defined as an explicit object
// literal (not a spread) so a future field can never leak in by accident.
function toExample(r: FeedbackRecord): FeedbackExample {
  return {
    createdAt: r.createdAt,
    merchantGuess: r.merchantGuess,
    receiptType: r.receiptType,
    provider: r.provider,
    predictedAmount: r.predictedAmount,
    finalAmount: r.finalAmount,
    amountChanged: r.amountChanged,
    predictedInvoiceDate: r.predictedInvoiceDate,
    finalInvoiceDate: r.finalInvoiceDate,
    invoiceDateChanged: r.invoiceDateChanged,
    invoiceNumberChanged: r.invoiceNumberChanged,
  };
}

const isCorrect = (r: FeedbackRecord) =>
  !r.amountChanged && !r.invoiceDateChanged && !r.invoiceNumberChanged;

const isCorrected = (r: FeedbackRecord) =>
  r.amountChanged || r.invoiceDateChanged || r.invoiceNumberChanged;

/** Sort a stat list by correction count (desc), then sample size (desc). */
export function topByCorrectionCount<T extends { correctionCount: number; total: number }>(
  stats: T[],
  limit: number,
): T[] {
  return [...stats]
    .sort((a, b) => b.correctionCount - a.correctionCount || b.total - a.total)
    .slice(0, limit);
}

/**
 * Pure summary over correction-feedback records. Empty-input safe: returns zeroed
 * rates and empty lists, never throws.
 */
export function summarizeLearningInsights(records: FeedbackRecord[]): LearningInsights {
  const total = records.length;
  let amountChanged = 0;
  let dateChanged = 0;
  let invoiceChanged = 0;

  const merchantMap = new Map<string, MerchantStat>();
  const typeMap = new Map<string, ReceiptTypeStat>();
  const providerMap = new Map<string, ProviderStat & { _amount: number; _date: number; _invoice: number }>();

  for (const r of records) {
    if (r.amountChanged) amountChanged += 1;
    if (r.invoiceDateChanged) dateChanged += 1;
    if (r.invoiceNumberChanged) invoiceChanged += 1;

    // Per merchant (skip rows without a usable merchant guess).
    const merchant = r.merchantGuess?.trim();
    if (merchant) {
      const m =
        merchantMap.get(merchant) ??
        {
          merchant,
          total: 0,
          amountChanged: 0,
          dateChanged: 0,
          invoiceChanged: 0,
          correctionCount: 0,
          amountChangeRate: 0,
        };
      m.total += 1;
      if (r.amountChanged) m.amountChanged += 1;
      if (r.invoiceDateChanged) m.dateChanged += 1;
      if (r.invoiceNumberChanged) m.invoiceChanged += 1;
      merchantMap.set(merchant, m);
    }

    // Per receipt type.
    const t =
      typeMap.get(r.receiptType) ??
      {
        receiptType: r.receiptType,
        total: 0,
        amountChanged: 0,
        dateChanged: 0,
        invoiceChanged: 0,
        correctionCount: 0,
        amountChangeRate: 0,
        invoiceChangeRate: 0,
      };
    t.total += 1;
    if (r.amountChanged) t.amountChanged += 1;
    if (r.invoiceDateChanged) t.dateChanged += 1;
    if (r.invoiceNumberChanged) t.invoiceChanged += 1;
    typeMap.set(r.receiptType, t);

    // Per provider/strategy.
    const key = `${r.provider} / ${r.strategy}`;
    const p =
      providerMap.get(key) ??
      {
        key,
        provider: r.provider,
        strategy: r.strategy,
        total: 0,
        amountChangeRate: 0,
        dateChangeRate: 0,
        invoiceChangeRate: 0,
        _amount: 0,
        _date: 0,
        _invoice: 0,
      };
    p.total += 1;
    if (r.amountChanged) p._amount += 1;
    if (r.invoiceDateChanged) p._date += 1;
    if (r.invoiceNumberChanged) p._invoice += 1;
    providerMap.set(key, p);
  }

  const merchants = [...merchantMap.values()]
    .map((m) => ({
      ...m,
      correctionCount: m.amountChanged + m.dateChanged + m.invoiceChanged,
      amountChangeRate: ratio(m.amountChanged, m.total),
    }))
    .sort((a, b) => b.total - a.total);

  const receiptTypes = [...typeMap.values()]
    .map((t) => ({
      ...t,
      correctionCount: t.amountChanged + t.dateChanged + t.invoiceChanged,
      amountChangeRate: ratio(t.amountChanged, t.total),
      invoiceChangeRate: ratio(t.invoiceChanged, t.total),
    }))
    .sort((a, b) => b.total - a.total);

  const providerPerformance = [...providerMap.values()]
    .map(({ _amount, _date, _invoice, ...p }) => ({
      ...p,
      amountChangeRate: ratio(_amount, p.total),
      dateChangeRate: ratio(_date, p.total),
      invoiceChangeRate: ratio(_invoice, p.total),
    }))
    .sort((a, b) => b.total - a.total);

  const byRecent = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    totalRecords: total,
    amountCorrectionRate: rate(amountChanged, total),
    dateCorrectionRate: rate(dateChanged, total),
    invoiceCorrectionRate: rate(invoiceChanged, total),
    merchants,
    receiptTypes,
    providerPerformance,
    recentExamples: byRecent.slice(0, EXAMPLE_LIMIT).map(toExample),
    correctExamples: byRecent.filter(isCorrect).slice(0, SUB_EXAMPLE_LIMIT).map(toExample),
    correctedExamples: byRecent.filter(isCorrected).slice(0, SUB_EXAMPLE_LIMIT).map(toExample),
  };
}

// ── DB wrapper (thin; the ONLY place household scoping is enforced) ───────────
// Both the page and the API call this so they can never diverge on the query or
// the field allowlist. The explicit `select` is the privacy guarantee: a future
// sensitive column cannot leak into insights without being added here on purpose.
const FEEDBACK_SELECT = {
  receiptType: true,
  merchantGuess: true,
  provider: true,
  strategy: true,
  parserVersion: true,
  invoiceNumberChanged: true,
  invoiceDateChanged: true,
  amountChanged: true,
  predictedAmount: true,
  finalAmount: true,
  predictedInvoiceDate: true,
  finalInvoiceDate: true,
  amountConfidence: true,
  createdAt: true,
} as const;

const MAX_FEEDBACK_ROWS = 2000;

export async function getHouseholdLearningInsights(
  householdId: string,
): Promise<LearningInsights> {
  const rows = await prisma.receiptCorrectionFeedback.findMany({
    where: { householdId },
    select: FEEDBACK_SELECT,
    orderBy: { createdAt: "desc" },
    take: MAX_FEEDBACK_ROWS,
  });

  const records: FeedbackRecord[] = rows.map((r) => ({
    receiptType: r.receiptType,
    merchantGuess: r.merchantGuess,
    provider: r.provider,
    strategy: r.strategy,
    parserVersion: r.parserVersion,
    invoiceNumberChanged: r.invoiceNumberChanged,
    invoiceDateChanged: r.invoiceDateChanged,
    amountChanged: r.amountChanged,
    predictedAmount: r.predictedAmount === null ? null : Number(r.predictedAmount),
    finalAmount: Number(r.finalAmount),
    predictedInvoiceDate: r.predictedInvoiceDate,
    finalInvoiceDate: r.finalInvoiceDate,
    amountConfidence: r.amountConfidence,
    createdAt: r.createdAt.toISOString(),
  }));

  return summarizeLearningInsights(records);
}
