import PDFDocument from "pdfkit";
import type { AccountantReport } from "@/lib/reporting";

// Accountant-ready PDF built with pdfkit (pure-JS, no native binaries; uses the
// built-in Helvetica AFM fonts so it works in serverless/Docker without shipping
// font files). Renders a header band, summary, and four tables (category, member
// by paid-by, monthly totals, expense register) with right-aligned currency,
// repeated table headers across page breaks, and "Page x of y" footers.

const PAGE_MARGIN = 48;
const FONT = "Helvetica";
const FONT_BOLD = "Helvetica-Bold";
const TEXT = "#0f172a"; // slate-900
const MUTED = "#64748b"; // slate-500
const RULE = "#e2e8f0"; // slate-200
const BRAND = "#4f46e5"; // brand-ish indigo
const ZEBRA = "#f8fafc"; // slate-50
const ROW_HEIGHT = 18;
const HEADER_ROW_HEIGHT = 20;

type Align = "left" | "right";
type Column<Row> = {
  label: string;
  width: number;
  align?: Align;
  value: (row: Row) => string;
};

function formatCurrency(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `$${safe.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

type Doc = PDFKit.PDFDocument;

function contentWidth(doc: Doc): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function contentBottom(doc: Doc): number {
  return doc.page.height - doc.page.margins.bottom;
}

function drawHeaderBand(doc: Doc, report: AccountantReport) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const from = formatDate(report.range.from);
  const to = formatDate(report.range.to);
  const generated = `${report.generatedAt.toISOString().slice(0, 19).replace("T", " ")} UTC`;

  doc.save();
  doc.rect(left, doc.y, width, 58).fill(BRAND);
  doc
    .fillColor("#ffffff")
    .font(FONT_BOLD)
    .fontSize(18)
    .text("Accountant Report", left + 16, doc.y - 58 + 12);
  doc
    .font(FONT)
    .fontSize(11)
    .fillColor("#e0e7ff")
    .text(report.household.name, left + 16, doc.y + 2);
  doc.restore();

  doc.moveDown(0.5);
  doc.fillColor(MUTED).font(FONT).fontSize(10);
  doc.text(`Reporting period: ${from} to ${to}`, left + 16);
  doc.text(`Generated: ${generated}`, left + 16);
  doc.moveDown(0.75);
}

function drawSummary(doc: Doc, report: AccountantReport) {
  const left = doc.page.margins.left;
  doc.fillColor(TEXT).font(FONT_BOLD).fontSize(13).text("Summary", left);
  doc.moveDown(0.3);
  doc.font(FONT).fontSize(10).fillColor(TEXT);
  const cells = [
    `Total spending: ${formatCurrency(report.totals.total)}`,
    `Expenses: ${report.totals.count}`,
    `Average expense: ${formatCurrency(report.totals.average)}`,
  ];
  doc.text(cells.join("       "), left);
  doc.moveDown(0.9);
}

function sectionTitle(doc: Doc, title: string) {
  if (doc.y + 60 > contentBottom(doc)) doc.addPage();
  doc.fillColor(TEXT).font(FONT_BOLD).fontSize(12).text(title, doc.page.margins.left);
  doc.moveDown(0.3);
}

function drawTableHeader<Row>(doc: Doc, columns: Column<Row>[]) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const top = doc.y;
  doc.save();
  doc.rect(left, top, width, HEADER_ROW_HEIGHT).fill("#eef2ff");
  doc.restore();
  doc.font(FONT_BOLD).fontSize(9).fillColor(TEXT);
  let x = left;
  for (const col of columns) {
    doc.text(col.label, x + 6, top + 6, {
      width: col.width - 12,
      align: col.align ?? "left",
      lineBreak: false,
    });
    x += col.width;
  }
  doc.y = top + HEADER_ROW_HEIGHT;
}

function drawTable<Row>(doc: Doc, columns: Column<Row>[], rows: Row[], emptyText: string) {
  drawTableHeader(doc, columns);
  const left = doc.page.margins.left;
  const width = contentWidth(doc);

  if (rows.length === 0) {
    doc.font(FONT).fontSize(9).fillColor(MUTED).text(emptyText, left + 6, doc.y + 5);
    doc.y += ROW_HEIGHT;
    doc.moveDown(0.8);
    return;
  }

  doc.font(FONT).fontSize(9);
  rows.forEach((row, index) => {
    if (doc.y + ROW_HEIGHT > contentBottom(doc)) {
      doc.addPage();
      drawTableHeader(doc, columns);
      doc.font(FONT).fontSize(9);
    }
    const top = doc.y;
    if (index % 2 === 1) {
      doc.save();
      doc.rect(left, top, width, ROW_HEIGHT).fill(ZEBRA);
      doc.restore();
    }
    doc.fillColor(TEXT);
    let x = left;
    for (const col of columns) {
      doc.text(col.value(row), x + 6, top + 5, {
        width: col.width - 12,
        align: col.align ?? "left",
        lineBreak: false,
        ellipsis: true,
      });
      x += col.width;
    }
    doc.y = top + ROW_HEIGHT;
  });

  // bottom rule
  doc.save();
  doc.strokeColor(RULE).lineWidth(0.5).moveTo(left, doc.y).lineTo(left + width, doc.y).stroke();
  doc.restore();
  doc.moveDown(0.8);
}

function drawPageNumbers(doc: Doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const text = `Page ${i - range.start + 1} of ${range.count}`;
    doc
      .font(FONT)
      .fontSize(8)
      .fillColor(MUTED)
      .text(
        text,
        doc.page.margins.left,
        doc.page.height - doc.page.margins.bottom + 8,
        { width: contentWidth(doc), align: "right", lineBreak: false },
      );
  }
}

export function reportToPdf(report: AccountantReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: PAGE_MARGIN,
      bufferPages: true,
      info: {
        Title: `Accountant Report - ${report.household.name}`,
        Author: "MyFamilyExpenses",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const full = contentWidth(doc);

    drawHeaderBand(doc, report);
    drawSummary(doc, report);

    sectionTitle(doc, "Category breakdown");
    drawTable(
      doc,
      [
        { label: "Category", width: full - 200, value: (r: AccountantReport["categoryBreakdown"][number]) => r.name },
        { label: "Total", width: 120, align: "right", value: (r) => formatCurrency(r.total) },
        { label: "Count", width: 80, align: "right", value: (r) => String(r.count) },
      ],
      report.categoryBreakdown,
      "No category spending in this period.",
    );

    sectionTitle(doc, "Member breakdown (paid by)");
    drawTable(
      doc,
      [
        { label: "Member (paid by)", width: full - 200, value: (r: AccountantReport["memberBreakdown"][number]) => r.name },
        { label: "Total", width: 120, align: "right", value: (r) => formatCurrency(r.total) },
        { label: "Count", width: 80, align: "right", value: (r) => String(r.count) },
      ],
      report.memberBreakdown,
      "No member spending in this period.",
    );

    sectionTitle(doc, "Monthly totals");
    drawTable(
      doc,
      [
        { label: "Month", width: full - 200, value: (r: AccountantReport["monthlyTotals"][number]) => r.month },
        { label: "Total", width: 120, align: "right", value: (r) => formatCurrency(r.total) },
        { label: "Count", width: 80, align: "right", value: (r) => String(r.count) },
      ],
      report.monthlyTotals,
      "No monthly totals in this period.",
    );

    sectionTitle(doc, "Expense register");
    const amountW = 80;
    const dateW = 70;
    const remaining = full - dateW - amountW;
    drawTable(
      doc,
      [
        { label: "Date", width: dateW, value: (r: AccountantReport["expenses"][number]) => formatDate(r.invoiceDate) },
        { label: "Invoice", width: Math.round(remaining * 0.24), value: (r) => r.invoiceNumber },
        { label: "Category", width: Math.round(remaining * 0.26), value: (r) => r.categoryName },
        { label: "Paid by", width: Math.round(remaining * 0.25), value: (r) => r.userName },
        { label: "Entered by", width: Math.round(remaining * 0.25), value: (r) => r.enteredByUserName },
        { label: "Amount", width: amountW, align: "right", value: (r) => formatCurrency(r.amount) },
      ],
      report.expenses,
      "No expenses in this period.",
    );

    drawPageNumbers(doc);
    doc.end();
  });
}
