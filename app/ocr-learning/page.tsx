import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Alert, Badge, Card, Table } from "@/components/ui";
import { requireHouseholdMember } from "@/lib/auth/session";
import { canViewOcrLearning } from "@/lib/auth/permissions";
import {
  getHouseholdLearningInsights,
  topByCorrectionCount,
  type FeedbackExample,
} from "@/lib/ocr/learning-insights";
import {
  buildTemplateRecommendations,
  generateTemplateDraft,
  validateTemplateDraft,
  type RiskLevel,
  type RecommendationSeverity,
} from "@/lib/ocr/templates";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

const pct = (rate: number) => `${Math.round(rate * 100)}%`;
const amount = (value: number | null) =>
  value === null ? "—" : formatCurrency(value.toString());
const day = (iso: string) => iso.slice(0, 10);

const severityBadge: Record<RecommendationSeverity, "warning" | "brand" | "neutral"> = {
  warning: "warning",
  suggestion: "brand",
  info: "neutral",
};

const riskBadge: Record<RiskLevel, "danger" | "warning" | "neutral"> = {
  high: "danger",
  medium: "warning",
  low: "neutral",
};

function ExampleRows({ examples }: { examples: FeedbackExample[] }) {
  return (
    <Table className="mt-3">
      <thead>
        <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
          <th className="px-2 py-2 text-left">Date</th>
          <th className="px-2 py-2 text-left">Merchant</th>
          <th className="px-2 py-2 text-left">Type</th>
          <th className="px-2 py-2 text-right">Predicted</th>
          <th className="px-2 py-2 text-right">Saved</th>
          <th className="px-2 py-2 text-left">Changed</th>
        </tr>
      </thead>
      <tbody>
        {examples.map((ex, i) => (
          <tr className="border-b border-slate-100 last:border-0" key={`${ex.createdAt}-${i}`}>
            <td className="whitespace-nowrap px-2 py-2 text-slate-600">{day(ex.createdAt)}</td>
            <td className="px-2 py-2 text-slate-700">{ex.merchantGuess ?? "—"}</td>
            <td className="px-2 py-2 text-slate-500">{ex.receiptType}</td>
            <td className="whitespace-nowrap px-2 py-2 text-right text-slate-600">{amount(ex.predictedAmount)}</td>
            <td className="whitespace-nowrap px-2 py-2 text-right font-semibold text-slate-900">{amount(ex.finalAmount)}</td>
            <td className="px-2 py-2">
              <div className="flex flex-wrap gap-1">
                {ex.amountChanged ? <Badge variant="warning">amount</Badge> : null}
                {ex.invoiceDateChanged ? <Badge variant="warning">date</Badge> : null}
                {ex.invoiceNumberChanged ? <Badge variant="neutral">invoice</Badge> : null}
                {!ex.amountChanged && !ex.invoiceDateChanged && !ex.invoiceNumberChanged ? (
                  <Badge variant="success">correct</Badge>
                ) : null}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export default async function OcrLearningPage() {
  const auth = await requireHouseholdMember();
  // Internal diagnostics: OWNER/ADMIN only. Hide existence from everyone else.
  if (!canViewOcrLearning(auth)) {
    notFound();
  }

  const insights = await getHouseholdLearningInsights(auth.householdId);
  const recommendations = buildTemplateRecommendations(insights);
  const topMerchants = topByCorrectionCount(insights.merchants, 10);
  const topReceiptTypes = topByCorrectionCount(insights.receiptTypes, 10);
  // Draft generation is human-review only: built here, written nowhere, never
  // wired to the parser. Each draft is validated before display.
  const drafts = recommendations
    .map((rec) => {
      const draft = generateTemplateDraft(rec);
      return draft ? { draft, validation: validateTemplateDraft(draft) } : null;
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);

  return (
    <AppShell auth={auth}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Internal OCR diagnostics</h1>
          <p className="text-sm text-slate-500">
            {auth.householdName} — receipt-scanning accuracy and template review. Owner/admin only.
          </p>
        </div>

        <Alert variant="warning">
          <strong>Internal diagnostics — not shown to regular users.</strong> This page is for
          people who run the household. <strong>No parser rules are auto-applied.</strong> Template
          suggestions and drafts below require human review before they could ever change scanning.
          No raw receipt text, card/account numbers, or reference numbers are shown here.
        </Alert>

        {insights.totalRecords === 0 ? (
          <Card>
            <h2 className="text-lg font-semibold text-slate-900">No OCR learning data yet</h2>
            <p className="mt-2 text-sm text-slate-500">
              Once receipts are scanned and expenses saved, correction trends and template
              suggestions will appear here.
            </p>
          </Card>
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Card>
                <p className="text-sm font-medium text-slate-500">Feedback records</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">{insights.totalRecords}</p>
              </Card>
              <Card>
                <p className="text-sm font-medium text-slate-500">Amount correction rate</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">{pct(insights.amountCorrectionRate.rate)}</p>
                <p className="text-xs text-slate-400">
                  {insights.amountCorrectionRate.changed} of {insights.amountCorrectionRate.total} changed
                </p>
              </Card>
              <Card>
                <p className="text-sm font-medium text-slate-500">Date correction rate</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">{pct(insights.dateCorrectionRate.rate)}</p>
                <p className="text-xs text-slate-400">
                  {insights.dateCorrectionRate.changed} of {insights.dateCorrectionRate.total} changed
                </p>
              </Card>
              <Card>
                <p className="text-sm font-medium text-slate-500">Invoice correction rate</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">{pct(insights.invoiceCorrectionRate.rate)}</p>
                <p className="text-xs text-slate-400">
                  {insights.invoiceCorrectionRate.changed} of {insights.invoiceCorrectionRate.total} changed
                </p>
              </Card>
            </section>

            <Card>
              <h2 className="text-lg font-semibold text-slate-900">Template suggestions (for review)</h2>
              <p className="text-sm text-slate-500">
                Ideas a person reviews — nothing here is applied automatically.
              </p>
              <div className="mt-3 space-y-3">
                {recommendations.length === 0 ? (
                  <p className="py-3 text-sm text-slate-500">
                    Not enough data yet for confident suggestions. Keep scanning receipts.
                  </p>
                ) : (
                  recommendations.map((rec, i) => (
                    <div
                      className="rounded-lg border border-slate-200 p-3"
                      key={`${rec.kind}-${rec.target}-${i}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={severityBadge[rec.severity]}>{rec.kind}</Badge>
                        <Badge variant={riskBadge[rec.riskLevel]}>risk: {rec.riskLevel}</Badge>
                        <span className="text-sm font-medium text-slate-800">
                          {rec.scope}: {rec.target}
                        </span>
                        <span className="text-xs text-slate-400">n={rec.sampleSize}</span>
                      </div>
                      <p className="mt-2 text-sm text-slate-700">{rec.message}</p>
                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                        <span>amount {pct(rec.rates.amount)}</span>
                        <span>date {pct(rec.rates.date)}</span>
                        <span>invoice {pct(rec.rates.invoice)}</span>
                      </div>
                      <p className="mt-2 text-xs font-medium text-slate-600">
                        Suggested next action: {rec.suggestedAction}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </Card>

            {drafts.length > 0 ? (
              <Card>
                <h2 className="text-lg font-semibold text-slate-900">Template drafts (read-only)</h2>
                <p className="text-sm text-slate-500">
                  Generated for review only — not saved, not connected to the parser. Copy into a
                  reviewed static template after human checking.
                </p>
                <div className="mt-3 space-y-4">
                  {drafts.map(({ draft, validation }) => (
                    <div className="rounded-lg border border-slate-200 p-3" key={draft.id}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800">{draft.id}</span>
                        <Badge variant={validation.valid ? "success" : "danger"}>
                          {validation.valid ? "valid draft" : "invalid draft"}
                        </Badge>
                        <Badge variant={riskBadge[draft.evidence.riskLevel]}>
                          risk: {draft.evidence.riskLevel}
                        </Badge>
                      </div>
                      {validation.errors.length > 0 ? (
                        <ul className="mt-2 list-disc pl-5 text-xs text-rose-600">
                          {validation.errors.map((e, j) => (
                            <li key={j}>{e}</li>
                          ))}
                        </ul>
                      ) : null}
                      {validation.warnings.length > 0 ? (
                        <ul className="mt-2 list-disc pl-5 text-xs text-amber-600">
                          {validation.warnings.map((w, j) => (
                            <li key={j}>{w}</li>
                          ))}
                        </ul>
                      ) : null}
                      <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
                        {JSON.stringify(draft, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}

            <section className="grid gap-6 lg:grid-cols-2">
              <Card>
                <h2 className="text-lg font-semibold text-slate-900">Top merchants by corrections</h2>
                {topMerchants.length === 0 ? (
                  <p className="py-4 text-sm text-slate-500">No merchant data yet.</p>
                ) : (
                  <div className="mt-3 divide-y divide-slate-200">
                    {topMerchants.map((m) => (
                      <div className="flex items-center justify-between gap-4 py-3" key={m.merchant}>
                        <div>
                          <p className="font-medium text-slate-900">{m.merchant}</p>
                          <p className="text-xs text-slate-500">
                            {m.total} receipt{m.total === 1 ? "" : "s"} · amount changed {pct(m.amountChangeRate)}
                          </p>
                        </div>
                        <Badge variant={m.correctionCount > 0 ? "warning" : "success"}>
                          {m.correctionCount} correction{m.correctionCount === 1 ? "" : "s"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card>
                <h2 className="text-lg font-semibold text-slate-900">Top receipt types by corrections</h2>
                {topReceiptTypes.length === 0 ? (
                  <p className="py-4 text-sm text-slate-500">No receipt-type data yet.</p>
                ) : (
                  <div className="mt-3 divide-y divide-slate-200">
                    {topReceiptTypes.map((t) => (
                      <div className="flex items-center justify-between gap-4 py-3" key={t.receiptType}>
                        <div>
                          <p className="font-medium text-slate-900">{t.receiptType}</p>
                          <p className="text-xs text-slate-500">
                            {t.total} receipt{t.total === 1 ? "" : "s"} · amount {pct(t.amountChangeRate)} · invoice {pct(t.invoiceChangeRate)}
                          </p>
                        </div>
                        <Badge variant={t.correctionCount > 0 ? "warning" : "success"}>
                          {t.correctionCount} correction{t.correctionCount === 1 ? "" : "s"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </section>

            <Card>
              <h2 className="text-lg font-semibold text-slate-900">Provider &amp; strategy performance</h2>
              <Table className="mt-3">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                    <th className="px-2 py-2 text-left">Provider / strategy</th>
                    <th className="px-2 py-2 text-right">Receipts</th>
                    <th className="px-2 py-2 text-right">Amount changed</th>
                    <th className="px-2 py-2 text-right">Date changed</th>
                    <th className="px-2 py-2 text-right">Invoice changed</th>
                  </tr>
                </thead>
                <tbody>
                  {insights.providerPerformance.map((p) => (
                    <tr className="border-b border-slate-100 last:border-0" key={p.key}>
                      <td className="px-2 py-2 text-slate-700">{p.key}</td>
                      <td className="px-2 py-2 text-right text-slate-600">{p.total}</td>
                      <td className="px-2 py-2 text-right text-slate-600">{pct(p.amountChangeRate)}</td>
                      <td className="px-2 py-2 text-right text-slate-600">{pct(p.dateChangeRate)}</td>
                      <td className="px-2 py-2 text-right text-slate-600">{pct(p.invoiceChangeRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>

            <section className="grid gap-6 lg:grid-cols-2">
              <Card>
                <h2 className="text-lg font-semibold text-slate-900">Corrected examples</h2>
                <p className="text-sm text-slate-500">Where the saved value differed from the scan.</p>
                {insights.correctedExamples.length === 0 ? (
                  <p className="py-4 text-sm text-slate-500">No corrections recorded yet.</p>
                ) : (
                  <ExampleRows examples={insights.correctedExamples} />
                )}
              </Card>
              <Card>
                <h2 className="text-lg font-semibold text-slate-900">Correct examples</h2>
                <p className="text-sm text-slate-500">Where the scan already matched what you saved.</p>
                {insights.correctExamples.length === 0 ? (
                  <p className="py-4 text-sm text-slate-500">No fully-correct scans recorded yet.</p>
                ) : (
                  <ExampleRows examples={insights.correctExamples} />
                )}
              </Card>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
