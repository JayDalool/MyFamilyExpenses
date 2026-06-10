import { NextResponse } from "next/server";
import { getCurrentHousehold } from "@/lib/auth/session";
import {
  buildAccountantReport,
  countAccountantReportExpenses,
  MAX_SYNC_EXPORT_ROWS,
  parseReportFilters,
} from "@/lib/reporting";
import { reportToCsv } from "@/lib/reporting/export-csv";
import { reportToPdf } from "@/lib/reporting/export-pdf";
import { reportToXlsx } from "@/lib/reporting/export-xlsx";

export const dynamic = "force-dynamic";

// TODO: Add a dedicated report-export rate-limit store. Existing login,
// invite, and password-reset limiters have domain-specific tables and keys.
const EXPORTS = {
  csv: {
    contentType: "text/csv; charset=utf-8",
    extension: "csv",
    serialize: (report: Awaited<ReturnType<typeof buildAccountantReport>>) =>
      Buffer.from(reportToCsv(report), "utf8"),
  },
  pdf: {
    contentType: "application/pdf",
    extension: "pdf",
    serialize: reportToPdf,
  },
  xlsx: {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: "xlsx",
    serialize: reportToXlsx,
  },
} as const;

function fileSlug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase()
    .slice(0, 60) || "household";
}

export async function GET(request: Request) {
  const auth = await getCurrentHousehold();
  if (!auth) {
    return NextResponse.json(
      { error: { message: "Authentication required." } },
      { status: 401 },
    );
  }

  const searchParams = Object.fromEntries(new URL(request.url).searchParams.entries());
  const format = searchParams.format;
  const selectedExport = format && format in EXPORTS
    ? EXPORTS[format as keyof typeof EXPORTS]
    : null;

  if (!selectedExport) {
    return NextResponse.json(
      { error: { message: "Choose a valid export format: pdf, csv, or xlsx." } },
      { status: 400 },
    );
  }

  const parsedFilters = parseReportFilters(searchParams);
  if (!parsedFilters.ok) {
    return NextResponse.json({ error: parsedFilters.error }, { status: 400 });
  }
  const filters = parsedFilters.filters;
  const expenseCount = await countAccountantReportExpenses(auth.householdId, filters);
  if (expenseCount > MAX_SYNC_EXPORT_ROWS) {
    return NextResponse.json(
      { error: "This report is too large for instant export. Please narrow the date range." },
      { status: 413 },
    );
  }

  const report = await buildAccountantReport(
    { id: auth.householdId, name: auth.householdName },
    filters,
  );
  const body = selectedExport.serialize(report);
  const generatedDate = report.generatedAt.toISOString().slice(0, 10);
  const fileName =
    `myfamilyexpenses-${fileSlug(auth.householdName)}-${filters.period}-${generatedDate}` +
    `.${selectedExport.extension}`;

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Type": selectedExport.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
