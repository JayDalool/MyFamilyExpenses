import { AppShell } from "@/components/app-shell";
import { Alert, Badge, Card, Table } from "@/components/ui";
import { requireHouseholdMember } from "@/lib/auth/session";
import {
  getHouseholdLearningInsights,
  topByCorrectionCount,
  type FeedbackExample,
} from "@/lib/ocr/learning-insights";
import {
  buildTemplateRecommendations,
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
  const insights = await getHouseholdLearningInsights(auth.householdId);
  const recommendations = buildTemplateRecommendations(insights);
  const topMerchants = topByCorrectionCount(insights.merchants, 10);
  const topReceiptTypes = topByCorrectionCount(insights.receiptTypes, 10);

  return (
    <AppShell auth={auth}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">OCR learning insights</h1>
          <p className="text-sm text-slate-500">
            {auth.householdName} — how often the scanner&apos;s reading matched what you saved.
          </p>
        </div>

        <Alert variant="info">
          This page summarises receipt corrections to help us improve scanning. It records a
          learning signal only — it does <strong>not</strong> change how receipts are read
          automatically. Any parser/template change is reviewed by a person first. No raw receipt
          text, card numbers, or reference numbers are shown here.
        </Alert>

        {insights.totalRecords === 0 ? (
          <Card>
            <h2 className="text-lg font-semibold text-slate-900">No OCR learning data yet</h2>
            <p className="mt-2 text-sm text-slate-500">
              Once you scan receipts and save expenses, we&apos;ll compare what the scanner read
              against what you saved and show the trends here.
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
                <p className="mt-2 text-2xl font-bold text-slate-900">
                  {pct(insights.amountCorrectionRate.rate)}
                </p>
                <p className="text-xs text-slate-400">
                  {insights.amountCorrectionRate.changed} of {insights.amountCorrectionRate.total} changed
                </p>
              </Card>
              <Card>
                <p className="text-sm font-medium text-slate-500">Date correction rate</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">
                  {pct(insights.dateCorrectionRate.rate)}
                </p>
                <p className="text-xs text-slate-400">
                  {insights.dateCorrectionRate.changed} of {insights.dateCorrectionRate.total} changed
                </p>
              </Card>
              <Card>
                <p className="text-sm font-medium text-slate-500">Invoice correction rate</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">
                  {pct(insights.invoiceCorrectionRate.rate)}
                </p>
                <p className="text-xs text-slate-400">
                  {insights.invoiceCorrectionRate.changed} of {insights.invoiceCorrectionRate.total} changed
                </p>
              </Card>
            </section>

            <Card>
              <h2 className="text-lg font-semibold text-slate-900">Template suggestions (for review)</h2>
              <p className="text-sm text-slate-500">
                Ideas a person can review — nothing here is applied automatically.
              </p>
              <div className="mt-3 space-y-2">
                {recommendations.length === 0 ? (
                  <p className="py-3 text-sm text-slate-500">
                    Not enough data yet for confident suggestions. Keep scanning receipts.
                  </p>
                ) : (
                  recommendations.map((rec, i) => (
                    <div
                      className="flex flex-col gap-1 rounded-lg border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between"
                      key={`${rec.kind}-${rec.target}-${i}`}
                    >
                      <p className="text-sm text-slate-700">{rec.message}</p>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={severityBadge[rec.severity]}>{rec.metric}</Badge>
                        <span className="text-xs text-slate-400">n={rec.sampleSize}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

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
