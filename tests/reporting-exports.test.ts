import assert from "node:assert/strict";
import test from "node:test";
import type { AccountantReport } from "../lib/reporting";
import { reportToCsv } from "../lib/reporting/export-csv";
import { reportToPdf } from "../lib/reporting/export-pdf";
import { reportToXlsx } from "../lib/reporting/export-xlsx";

const report: AccountantReport = {
  household: { id: "household-id", name: "Family & Co" },
  range: {
    from: new Date("2026-01-01T00:00:00.000Z"),
    to: new Date("2026-12-31T00:00:00.000Z"),
  },
  generatedAt: new Date("2026-06-09T12:00:00.000Z"),
  filters: { period: "year" },
  totals: { total: 123.45, count: 1, average: 123.45 },
  categoryBreakdown: [
    { categoryId: "category-id", name: "Office supplies", total: 123.45, count: 1 },
  ],
  memberBreakdown: [
    { userId: "user-id", name: "Taylor User", total: 123.45, count: 1 },
  ],
  monthlyTotals: [{ month: "2026-06", total: 123.45, count: 1 }],
  expenses: [
    {
      id: "expense-id",
      invoiceNumber: "INV-001",
      invoiceDate: new Date("2026-06-02T00:00:00.000Z"),
      amount: 123.45,
      categoryId: "category-id",
      categoryName: "Office supplies",
      userId: "user-id",
      userName: "Taylor User",
      enteredByUserId: "entered-by-id",
      enteredByUserName: "Jordan Uploader",
      filePath: "uploads/invoice.pdf",
    },
  ],
};

test("CSV export contains accountant report sections and expense data", () => {
  const csv = reportToCsv(report);

  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /Household,Family & Co/);
  assert.match(csv, /Category breakdown/);
  assert.match(csv, /Member breakdown \(paid by\)/);
  assert.match(csv, /Monthly totals/);
  assert.match(csv, /Expense register/);
  assert.match(csv, /INV-001/);
  assert.match(csv, /uploads\/invoice\.pdf/);
});

test("CSV expense register includes both paid-by and entered-by", () => {
  const csv = reportToCsv(report);

  assert.match(csv, /Paid by \(member\),Entered by/);
  // Paid-by member then entered-by uploader on the expense row.
  assert.match(csv, /INV-001,2026-06-02,Office supplies,Taylor User,Jordan Uploader,123\.45/);
});

test("CSV export neutralizes spreadsheet formula injection", () => {
  const csv = reportToCsv({
    ...report,
    household: { ...report.household, name: "=DANGEROUS()" },
    expenses: [{ ...report.expenses[0]!, invoiceNumber: "+CMD" }],
  });

  assert.match(csv, /Household,'=DANGEROUS\(\)/);
  assert.match(csv, /'\+CMD/);
});

test("PDF export produces a non-empty PDF document", async () => {
  const pdf = await reportToPdf(report);

  assert.ok(pdf.length > 500);
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.match(pdf.subarray(-1024).toString("latin1"), /%%EOF/);
});

// Counts page objects in the PDF (the page dictionaries are not compressed, only
// content streams are). Excludes the single /Type /Pages tree node.
function countPdfPages(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page(?![s])/g) ?? []).length;
}

test("PDF export does not emit a trailing blank page for a short report", async () => {
  // Regression: a width/align footer drawn in the bottom margin used to make
  // pdfkit auto-append a blank second page. A one-row report must be one page.
  const pdf = await reportToPdf(report);

  assert.equal(countPdfPages(pdf), 1);
});

test("PDF export paginates a long expense register without a blank final page", async () => {
  const many: AccountantReport = {
    ...report,
    totals: { total: 6000, count: 120, average: 50 },
    expenses: Array.from({ length: 120 }, (_, index) => ({
      ...report.expenses[0]!,
      id: `expense-${index}`,
      invoiceNumber: `INV-${1000 + index}`,
    })),
  };

  const pdf = await reportToPdf(many);
  const pages = countPdfPages(pdf);

  // 120 rows must span multiple pages, but no more than the rows can fill (a
  // trailing blank page would push this past the realistic maximum).
  assert.ok(pages >= 2, `expected multiple pages, got ${pages}`);
  assert.ok(pages <= 4, `unexpectedly many pages (possible blank page): ${pages}`);
});

test("XLSX export produces a non-empty OOXML zip", () => {
  const xlsx = reportToXlsx(report);

  assert.ok(xlsx.length > 500);
  assert.equal(xlsx.subarray(0, 2).toString("ascii"), "PK");
  assert.equal(xlsx.subarray(-22, -18).readUInt32LE(0), 0x06054b50);
});
