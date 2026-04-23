import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/auth/session";
import { getExpenseForUser } from "@/lib/expenses";
import {
  getStoredExpenseMimeType,
  isPreviewableImage,
} from "@/lib/expense-files";
import { formatCurrency } from "@/lib/utils";

type ExpenseDetailsPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function ExpenseDetailsPage({
  params,
}: ExpenseDetailsPageProps) {
  const user = await requireUser();
  const { id } = await params;
  const expense = await getExpenseForUser(user, id);

  if (!expense) {
    notFound();
  }

  const previewUrl = `/api/expenses/${expense.id}/file`;
  const downloadUrl = `${previewUrl}?download=1`;
  const mimeType = getStoredExpenseMimeType(expense.filePath);

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link
              className="text-sm font-medium text-brand-700 hover:text-brand-800"
              href="/expenses"
            >
              Back to expenses
            </Link>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900">
              {expense.invoiceNumber}
            </h1>
            <p className="text-sm text-slate-500">
              {expense.category.name} | {expense.invoiceDate.toISOString().slice(0, 10)}
              {user.role === "ADMIN" ? ` | ${expense.user.name}` : ""}
            </p>
          </div>

          <div className="flex gap-3">
            <a
              className="rounded-2xl border border-slate-300 px-4 py-3 font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
              href={previewUrl}
              rel="noreferrer"
              target="_blank"
            >
              Open preview
            </a>
            <a
              className="rounded-2xl bg-brand-600 px-4 py-3 font-semibold text-white transition hover:bg-brand-700"
              href={downloadUrl}
            >
              Download invoice
            </a>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[340px,1fr]">
          <section className="rounded-3xl bg-white p-6 shadow-soft">
            <h2 className="text-lg font-semibold text-slate-900">Saved invoice fields</h2>
            <p className="mt-1 text-sm text-slate-500">
              These are the reviewed invoice values stored with this expense.
            </p>

            <dl className="mt-4 space-y-4">
              <div>
                <dt className="text-sm font-medium text-slate-500">Invoice number</dt>
                <dd className="mt-1 text-slate-900">{expense.invoiceNumber}</dd>
              </div>

              <div>
                <dt className="text-sm font-medium text-slate-500">Amount</dt>
                <dd className="mt-1 text-2xl font-semibold text-slate-900">
                  {formatCurrency(expense.amount.toString())}
                </dd>
              </div>

              <div>
                <dt className="text-sm font-medium text-slate-500">Invoice date</dt>
                <dd className="mt-1 text-slate-900">
                  {expense.invoiceDate.toISOString().slice(0, 10)}
                </dd>
              </div>

              <div>
                <dt className="text-sm font-medium text-slate-500">Category</dt>
                <dd className="mt-1 text-slate-900">{expense.category.name}</dd>
              </div>
            </dl>

            <div className="mt-8 border-t border-slate-200 pt-6">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Invoice file
              </h3>

              <dl className="mt-4 space-y-4">
                <div>
                  <dt className="text-sm font-medium text-slate-500">Stored file</dt>
                  <dd className="mt-1 break-all text-sm text-slate-700">{expense.filePath}</dd>
                </div>

                <div>
                  <dt className="text-sm font-medium text-slate-500">File type</dt>
                  <dd className="mt-1 text-slate-900">{mimeType}</dd>
                </div>
              </dl>
            </div>
          </section>

          <section className="rounded-3xl bg-white p-6 shadow-soft">
            <h2 className="text-lg font-semibold text-slate-900">Invoice preview</h2>
            <p className="mt-1 text-sm text-slate-500">
              The file stays on local storage and is only served through the authenticated invoice route.
            </p>

            <div className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-slate-50">
              {mimeType === "application/pdf" ? (
                <iframe
                  className="h-[720px] w-full bg-white"
                  src={previewUrl}
                  title={`Invoice preview for ${expense.invoiceNumber}`}
                />
              ) : isPreviewableImage(expense.filePath) ? (
                <Image
                  alt={`Invoice preview for ${expense.invoiceNumber}`}
                  className="h-auto max-h-[720px] w-full object-contain bg-white"
                  height={1600}
                  src={previewUrl}
                  unoptimized
                  width={1200}
                />
              ) : (
                <div className="px-6 py-12 text-sm text-slate-500">
                  Preview is not available for this file type. Use the download button instead.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
