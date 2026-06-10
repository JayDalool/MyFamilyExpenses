import type { AccountantReport } from "@/lib/reporting";

const NEWLINE = "\r\n"; // RFC 4180-compliant line terminator

function escapeCell(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined) return "";
  let raw: string;
  if (value instanceof Date) {
    raw = value.toISOString().slice(0, 10);
  } else if (typeof value === "number") {
    // Force fixed 2-decimal currency formatting; accountants do not want
    // scientific notation or floats like 12.300000000001.
    raw = Number.isFinite(value) ? value.toFixed(2) : "0.00";
  } else {
    raw = String(value);
    if (/^[=+\-@]/.test(raw.trimStart())) {
      raw = `'${raw}`;
    }
  }
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
}

function toRow(values: Array<string | number | Date | null | undefined>) {
  return values.map(escapeCell).join(",");
}

/**
 * Build an accountant-friendly CSV from an AccountantReport.
 *
 * Sections (each separated by a blank line so Excel-style importers keep them
 * readable as one sheet):
 *   1. Header (household, period, generated at, totals)
 *   2. Category breakdown
 *   3. Member breakdown
 *   4. Monthly totals
 *   5. Full expense register
 *
 * Output starts with a UTF-8 BOM so Excel auto-detects encoding.
 */
export function reportToCsv(report: AccountantReport): string {
  const lines: string[] = [];
  const from = report.range.from.toISOString().slice(0, 10);
  const to = report.range.to.toISOString().slice(0, 10);

  lines.push(toRow(["Household", report.household.name]));
  lines.push(toRow(["Reporting period", `${from} to ${to}`]));
  lines.push(toRow(["Generated at", report.generatedAt.toISOString()]));
  lines.push(toRow(["Total spending", report.totals.total]));
  lines.push(toRow(["Expense count", report.totals.count]));
  lines.push(toRow(["Average expense", report.totals.average]));
  lines.push("");

  lines.push(toRow(["Category breakdown"]));
  lines.push(toRow(["Category", "Total", "Count"]));
  for (const row of report.categoryBreakdown) {
    lines.push(toRow([row.name, row.total, row.count]));
  }
  lines.push("");

  lines.push(toRow(["Member breakdown (paid by)"]));
  lines.push(toRow(["Member (paid by)", "Total", "Count"]));
  for (const row of report.memberBreakdown) {
    lines.push(toRow([row.name, row.total, row.count]));
  }
  lines.push("");

  lines.push(toRow(["Monthly totals"]));
  lines.push(toRow(["Month", "Total", "Count"]));
  for (const row of report.monthlyTotals) {
    lines.push(toRow([row.month, row.total, row.count]));
  }
  lines.push("");

  lines.push(toRow(["Expense register"]));
  lines.push(
    toRow([
      "Invoice number",
      "Invoice date",
      "Category",
      "Paid by (member)",
      "Entered by",
      "Amount",
      "Receipt reference",
    ]),
  );
  for (const expense of report.expenses) {
    lines.push(
      toRow([
        expense.invoiceNumber,
        expense.invoiceDate,
        expense.categoryName,
        expense.userName,
        expense.enteredByUserName,
        expense.amount,
        expense.filePath,
      ]),
    );
  }

  return "\uFEFF" + lines.join(NEWLINE) + NEWLINE;
}
