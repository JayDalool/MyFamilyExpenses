import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { canViewReports } from "@/lib/auth/permissions";
import { getCurrentUser, getUserHousehold } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";
import {
  buildAccountantReport,
  countAccountantReportExpenses,
  getReportCurrencies,
  MAX_SYNC_EXPORT_ROWS,
  MIXED_REPORT_CURRENCIES_MESSAGE,
  parseReportFilters,
} from "@/lib/reporting";
import { reportToCsv } from "@/lib/reporting/export-csv";
import { accountantPackageStream, planAccountantPackage } from "@/lib/reporting/export-package";
import { reportToPdf } from "@/lib/reporting/export-pdf";
import { reportToXlsx } from "@/lib/reporting/export-xlsx";

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

function exportFileName(householdName: string, period: string, generatedAt: Date, extension: string) {
  const generatedDate = generatedAt.toISOString().slice(0, 10);
  return `myfamilyexpenses-${fileSlug(householdName)}-${period}-${generatedDate}.${extension}`;
}

export async function downloadReport(request: Request, workspaceId?: string) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { message: "Authentication required." } },
      { status: 401 },
    );
  }
  const auth = await getUserHousehold(user, workspaceId);
  if (!auth) {
    return NextResponse.json(
      { error: { message: workspaceId === undefined ? "Authentication required." : "Workspace not found." } },
      { status: workspaceId === undefined ? 401 : 404 },
    );
  }

  if (!canViewReports(auth)) {
    return NextResponse.json(
      { error: { message: "You do not have access to household reports." } },
      { status: 403 },
    );
  }

  const searchParams = Object.fromEntries(new URL(request.url).searchParams.entries());
  const format = searchParams.format;
  const selectedExport = format && Object.hasOwn(EXPORTS, format)
    ? EXPORTS[format as keyof typeof EXPORTS]
    : null;

  if (!selectedExport && format !== "zip") {
    return NextResponse.json(
      { error: { message: "Choose a valid export format: pdf, csv, xlsx, or zip." } },
      { status: 400 },
    );
  }

  const parsedFilters = parseReportFilters(searchParams);
  if (!parsedFilters.ok) {
    return NextResponse.json({ error: parsedFilters.error }, { status: 400 });
  }
  const filters = parsedFilters.filters;
  const reference = new Date();
  if (!filters.currency) {
    const currencies = await getReportCurrencies(auth.householdId, filters, undefined, reference);
    if (currencies.length > 1) {
      return NextResponse.json({ error: MIXED_REPORT_CURRENCIES_MESSAGE }, { status: 400 });
    }
    filters.currency = currencies[0] ?? "CAD";
  }
  if (workspaceId !== undefined) filters.sort ??= "date-desc";
  const userId = user.id;
  const householdId = auth.householdId;

  function auditExport(count: number) {
    return writeAuditLog({
      userId,
      householdId,
      action: "reports.export",
      metadata: { format: format ?? "zip", period: filters.period, currency: filters.currency ?? "CAD", count },
    });
  }

  // The year-end package streams receipt files, so it has no row cap.
  if (!selectedExport) {
    const report = await buildAccountantReport(
      { id: auth.householdId, name: auth.householdName },
      filters,
      undefined,
      reference,
    );
    const plan = await planAccountantPackage(report);
    const stream = await accountantPackageStream(plan);
    await auditExport(report.totals.count);
    return new NextResponse(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${exportFileName(auth.householdName, filters.period, report.generatedAt, "zip")}"`,
        "Content-Type": "application/zip",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const expenseCount = await countAccountantReportExpenses(auth.householdId, filters, undefined, reference);
  if (expenseCount > MAX_SYNC_EXPORT_ROWS) {
    return NextResponse.json(
      { error: "This report is too large for instant export. Please narrow the date range." },
      { status: 413 },
    );
  }

  const report = await buildAccountantReport(
    { id: auth.householdId, name: auth.householdName },
    filters,
    undefined,
    reference,
  );
  // PDF serializer is async (pdfkit streams); CSV/XLSX are sync — await is harmless.
  const body = await selectedExport.serialize(report);
  await auditExport(report.totals.count);
  const fileName = exportFileName(
    auth.householdName,
    filters.period,
    report.generatedAt,
    selectedExport.extension,
  );

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Type": selectedExport.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
