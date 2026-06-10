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
      filePath: "uploads/invoice.pdf",
    },
  ],
};

test("CSV export contains accountant report sections and expense data", () => {
  const csv = reportToCsv(report);

  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /Household,Family & Co/);
  assert.match(csv, /Category breakdown/);
  assert.match(csv, /Member breakdown/);
  assert.match(csv, /Monthly totals/);
  assert.match(csv, /Expense register/);
  assert.match(csv, /INV-001/);
  assert.match(csv, /uploads\/invoice\.pdf/);
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

test("PDF export produces a non-empty PDF document", () => {
  const pdf = reportToPdf(report);

  assert.ok(pdf.length > 500);
  assert.equal(pdf.subarray(0, 8).toString("ascii"), "%PDF-1.4");
  assert.match(pdf.subarray(-32).toString("ascii"), /%%EOF/);
});

test("XLSX export produces a non-empty OOXML zip", () => {
  const xlsx = reportToXlsx(report);

  assert.ok(xlsx.length > 500);
  assert.equal(xlsx.subarray(0, 2).toString("ascii"), "PK");
  assert.equal(xlsx.subarray(-22, -18).readUInt32LE(0), 0x06054b50);
});
