import PDFDocument from "pdfkit";
import type { AccountantReport } from "@/lib/reporting";

// Accountant-ready PDF built with pdfkit (pure-JS, no native binaries; uses the
// built-in Helvetica AFM fonts so it works in serverless/Docker without shipping
// font files). Laid out like a clean monthly statement: a light header with an
// accent rule, three KPI summary cards, side-by-side category/member breakdowns
// (which gracefully stack when long), monthly totals, and a paginated expense
// register. Footers ("Page X of Y") are drawn on real pages only.

// ── Page geometry ────────────────────────────────────────────────────────────
const MARGIN = 44; // pt
const FOOTER_RESERVE = 26; // keep body clear of the footer band
const PAD = 6; // horizontal cell padding
const ROW_HEIGHT = 18;
const HEADER_ROW_HEIGHT = 20;

// ── Type ─────────────────────────────────────────────────────────────────────
const FONT = "Helvetica";
const FONT_BOLD = "Helvetica-Bold";

// ── Palette (matches the requested professional scheme) ──────────────────────
const TEXT = "#111827"; // near-black
const MUTED = "#6B7280"; // gray-500
const BORDER = "#E5E7EB"; // gray-200
const TABLE_HEADER_BG = "#F3F4F6"; // gray-100
const CARD_BG = "#F9FAFB"; // gray-50
const ZEBRA = "#F9FAFB"; // very light row shading
const ACCENT = "#1D4ED8"; // blue-700

type Doc = PDFKit.PDFDocument;
type Align = "left" | "right";
type Column<Row> = {
  label: string;
  width: number;
  align?: Align;
  value: (row: Row) => string;
};

// ── Formatting helpers ───────────────────────────────────────────────────────
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

/**
 * Truncate `text` to a single line that fits `maxWidth` at the doc's CURRENT
 * font/size, appending "..." when shortened. Pre-fitting (rather than relying on
 * pdfkit's `ellipsis` option) guarantees one line: `ellipsis` re-enables the line
 * wrapper, which can push a cell onto a second line and overlap the next row.
 */
function fitText(doc: Doc, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (doc.widthOfString(text) <= maxWidth) return text;
  const ellipsis = "...";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.widthOfString(text.slice(0, mid) + ellipsis) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + ellipsis : ellipsis;
}

// ── Geometry helpers ─────────────────────────────────────────────────────────
function contentWidth(doc: Doc): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function bodyBottom(doc: Doc): number {
  return doc.page.height - doc.page.margins.bottom - FOOTER_RESERVE;
}

/** Add a page if `needed` pt would overflow the body area. Returns true if added. */
function ensureSpace(doc: Doc, needed: number): boolean {
  if (doc.y + needed > bodyBottom(doc)) {
    doc.addPage();
    return true;
  }
  return false;
}

// ── Header ───────────────────────────────────────────────────────────────────
function drawHeader(doc: Doc, report: AccountantReport) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const right = left + width;
  const top = doc.page.margins.top;

  // Left column: brand label + household name.
  doc
    .font(FONT_BOLD)
    .fontSize(8)
    .fillColor(ACCENT)
    .text("MYFAMILYEXPENSES", left, top, { characterSpacing: 1, lineBreak: false });
  const leftW = width * 0.5;
  doc.font(FONT_BOLD).fontSize(15).fillColor(TEXT);
  doc.text(fitText(doc, report.household.name, leftW), left, top + 12, { width: leftW, lineBreak: false });

  // Right column: report title + period + generated date, right-aligned. The
  // right block starts past the left block to avoid any overlap band.
  const from = formatDate(report.range.from);
  const to = formatDate(report.range.to);
  const generated = `${report.generatedAt.toISOString().slice(0, 10)}`;
  const rightX = left + width * 0.52;
  const rightW = right - rightX;
  doc
    .font(FONT_BOLD)
    .fontSize(18)
    .fillColor(TEXT)
    .text("Monthly Expense Report", rightX, top, { width: rightW, align: "right", lineBreak: false });
  doc
    .font(FONT)
    .fontSize(9)
    .fillColor(MUTED)
    .text(`Period: ${from} to ${to}`, rightX, top + 22, { width: rightW, align: "right", lineBreak: false });
  doc
    .font(FONT)
    .fontSize(8)
    .fillColor(MUTED)
    .text(`Generated ${generated}`, rightX, top + 34, { width: rightW, align: "right", lineBreak: false });

  // Accent rule beneath the header.
  const ruleY = top + 50;
  doc.save().strokeColor(ACCENT).lineWidth(1.5).moveTo(left, ruleY).lineTo(right, ruleY).stroke().restore();

  doc.y = ruleY + 16;
}

// ── KPI summary cards ────────────────────────────────────────────────────────
function drawSummaryCards(doc: Doc, report: AccountantReport) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const gap = 12;
  const cardW = (width - gap * 2) / 3;
  const cardH = 56;

  ensureSpace(doc, cardH + 10);
  const top = doc.y;

  const cards: Array<{ label: string; value: string }> = [
    { label: "TOTAL SPENDING", value: formatCurrency(report.totals.total) },
    { label: "NUMBER OF EXPENSES", value: String(report.totals.count) },
    { label: "AVERAGE EXPENSE", value: formatCurrency(report.totals.average) },
  ];

  cards.forEach((card, index) => {
    const x = left + index * (cardW + gap);
    doc.save();
    doc.roundedRect(x, top, cardW, cardH, 6).fillAndStroke(CARD_BG, BORDER);
    doc.restore();
    doc
      .font(FONT_BOLD)
      .fontSize(8)
      .fillColor(MUTED)
      .text(card.label, x + 12, top + 12, { width: cardW - 24, characterSpacing: 0.5, lineBreak: false });
    doc.font(FONT_BOLD).fontSize(17).fillColor(TEXT);
    doc.text(fitText(doc, card.value, cardW - 24), x + 12, top + 27, { width: cardW - 24, lineBreak: false });
  });

  doc.y = top + cardH + 18;
}

// ── Section title ────────────────────────────────────────────────────────────
function drawSectionTitle(doc: Doc, title: string) {
  ensureSpace(doc, 30 + HEADER_ROW_HEIGHT + ROW_HEIGHT);
  doc.font(FONT_BOLD).fontSize(13).fillColor(TEXT).text(title, doc.page.margins.left, doc.y, { lineBreak: false });
  doc.y += 18;
}

// ── Low-level row helpers ────────────────────────────────────────────────────
function drawHeaderRow<Row>(doc: Doc, x: number, width: number, columns: Column<Row>[]) {
  const top = doc.y;
  doc.save();
  doc.rect(x, top, width, HEADER_ROW_HEIGHT).fill(TABLE_HEADER_BG);
  doc.restore();
  doc.font(FONT_BOLD).fontSize(9).fillColor(TEXT);
  let cx = x;
  for (const col of columns) {
    const cellW = col.width - PAD * 2;
    doc.text(fitText(doc, col.label, cellW), cx + PAD, top + 6, {
      width: cellW,
      align: col.align ?? "left",
      lineBreak: false,
    });
    cx += col.width;
  }
  doc.save().strokeColor(BORDER).lineWidth(0.6).moveTo(x, top + HEADER_ROW_HEIGHT).lineTo(x + width, top + HEADER_ROW_HEIGHT).stroke().restore();
  doc.y = top + HEADER_ROW_HEIGHT;
}

function drawBodyRow<Row>(
  doc: Doc,
  x: number,
  width: number,
  columns: Column<Row>[],
  row: Row,
  zebra: boolean,
) {
  const top = doc.y;
  if (zebra) {
    doc.save();
    doc.rect(x, top, width, ROW_HEIGHT).fill(ZEBRA);
    doc.restore();
  }
  doc.font(FONT).fontSize(9).fillColor(TEXT);
  let cx = x;
  for (const col of columns) {
    const cellW = col.width - PAD * 2;
    doc.text(fitText(doc, col.value(row), cellW), cx + PAD, top + 5, {
      width: cellW,
      align: col.align ?? "left",
      lineBreak: false,
    });
    cx += col.width;
  }
  doc.save().strokeColor(BORDER).lineWidth(0.4).moveTo(x, top + ROW_HEIGHT).lineTo(x + width, top + ROW_HEIGHT).stroke().restore();
  doc.y = top + ROW_HEIGHT;
}

/**
 * Full-width table that paginates and repeats its header on each new page.
 * Used for monthly totals and the expense register.
 */
function drawSimpleTable<Row>(doc: Doc, columns: Column<Row>[], rows: Row[], emptyText: string) {
  const x = doc.page.margins.left;
  const width = columns.reduce((sum, col) => sum + col.width, 0);

  drawHeaderRow(doc, x, width, columns);

  if (rows.length === 0) {
    doc.font(FONT).fontSize(9).fillColor(MUTED).text(emptyText, x + PAD, doc.y + 5, { lineBreak: false });
    doc.y += ROW_HEIGHT;
    doc.y += 10;
    return;
  }

  rows.forEach((row, index) => {
    if (doc.y + ROW_HEIGHT > bodyBottom(doc)) {
      doc.addPage();
      drawHeaderRow(doc, x, width, columns);
    }
    drawBodyRow(doc, x, width, columns, row, index % 2 === 1);
  });

  doc.y += 12;
}

/**
 * Fixed-position table drawn within a single column (no internal pagination).
 * Caller guarantees it fits. Returns the bottom Y so two can sit side-by-side.
 */
function drawColumnTable<Row>(
  doc: Doc,
  x: number,
  top: number,
  width: number,
  columns: Column<Row>[],
  rows: Row[],
  emptyText: string,
): number {
  doc.y = top;
  drawHeaderRow(doc, x, width, columns);
  if (rows.length === 0) {
    doc.font(FONT).fontSize(9).fillColor(MUTED);
    doc.text(fitText(doc, emptyText, width - PAD * 2), x + PAD, doc.y + 5, {
      width: width - PAD * 2,
      lineBreak: false,
    });
    return doc.y + ROW_HEIGHT;
  }
  rows.forEach((row, index) => {
    drawBodyRow(doc, x, width, columns, row, index % 2 === 1);
  });
  return doc.y;
}

// ── Breakdowns (category + member) ───────────────────────────────────────────
function drawBreakdowns(doc: Doc, report: AccountantReport) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const gap = 18;
  const colW = (width - gap) / 2;
  const cat = report.categoryBreakdown;
  const mem = report.memberBreakdown;

  // Compact two-column layout only when both tables are short enough to fit a
  // single block on one page; otherwise stack them and let each paginate.
  const maxRows = Math.max(cat.length, mem.length, 1);
  const blockHeight = 18 + HEADER_ROW_HEIGHT + maxRows * ROW_HEIGHT + 14;
  const fitsOnAPage = blockHeight <= bodyBottom(doc) - doc.page.margins.top;
  const sideBySide = cat.length <= 14 && mem.length <= 14 && fitsOnAPage;

  const totalW = 64;
  const countW = 46;
  const miniColumns = (label: string): Column<{ name: string; total: number; count: number }>[] => [
    { label, width: colW - totalW - countW, value: (r) => r.name },
    { label: "Total", width: totalW, align: "right", value: (r) => formatCurrency(r.total) },
    { label: "Count", width: countW, align: "right", value: (r) => String(r.count) },
  ];

  if (sideBySide) {
    ensureSpace(doc, blockHeight);
    const titleY = doc.y;
    doc.font(FONT_BOLD).fontSize(13).fillColor(TEXT);
    doc.text("Category breakdown", left, titleY, { width: colW, lineBreak: false });
    doc.text("Member breakdown (paid by)", left + colW + gap, titleY, { width: colW, lineBreak: false });

    const tableTop = titleY + 18;
    const catBottom = drawColumnTable(
      doc,
      left,
      tableTop,
      colW,
      miniColumns("Category"),
      cat,
      "No category spending.",
    );
    const memBottom = drawColumnTable(
      doc,
      left + colW + gap,
      tableTop,
      colW,
      miniColumns("Member"),
      mem,
      "No member spending.",
    );
    doc.y = Math.max(catBottom, memBottom) + 16;
    return;
  }

  // Stacked fallback — full width, paginated.
  const fullColumns = (label: string): Column<{ name: string; total: number; count: number }>[] => [
    { label, width: width - 120 - 80, value: (r) => r.name },
    { label: "Total", width: 120, align: "right", value: (r) => formatCurrency(r.total) },
    { label: "Count", width: 80, align: "right", value: (r) => String(r.count) },
  ];
  drawSectionTitle(doc, "Category breakdown");
  drawSimpleTable(doc, fullColumns("Category"), cat, "No category spending.");
  drawSectionTitle(doc, "Member breakdown (paid by)");
  drawSimpleTable(doc, fullColumns("Member"), mem, "No member spending.");
}

// ── Expense register (main detail table) ─────────────────────────────────────
function drawExpenseRegister(doc: Doc, report: AccountantReport) {
  drawSectionTitle(doc, "Expense register");

  const width = contentWidth(doc);
  const dateW = 64; // comfortably fits "YYYY-MM-DD" at 9pt
  const invoiceW = 82;
  const amountW = 72;
  const remaining = width - dateW - invoiceW - amountW;
  const categoryW = Math.round(remaining * 0.38);
  const paidW = Math.round(remaining * 0.31);
  const enteredW = remaining - categoryW - paidW;

  const columns: Column<AccountantReport["expenses"][number]>[] = [
    { label: "Date", width: dateW, value: (r) => formatDate(r.invoiceDate) },
    { label: "Invoice", width: invoiceW, value: (r) => r.invoiceNumber },
    { label: "Category", width: categoryW, value: (r) => r.categoryName },
    { label: "Paid by", width: paidW, value: (r) => r.userName },
    { label: "Entered by", width: enteredW, value: (r) => r.enteredByUserName },
    { label: "Amount", width: amountW, align: "right", value: (r) => formatCurrency(r.amount) },
  ];

  drawSimpleTable(doc, columns, report.expenses, "No expenses in this period.");
}

// ── Footer (real pages only) ─────────────────────────────────────────────────
function drawFooter(doc: Doc, report: AccountantReport) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const left = doc.page.margins.left;
    const width = contentWidth(doc);
    const y = doc.page.height - 30;

    // Temporarily drop the bottom margin so writing inside the margin band does
    // NOT trigger pdfkit's auto page-break (the cause of trailing blank pages
    // when a width/align is supplied to text()).
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    doc.save().strokeColor(BORDER).lineWidth(0.5).moveTo(left, y - 6).lineTo(left + width, y - 6).stroke().restore();
    doc.font(FONT).fontSize(8).fillColor(MUTED);
    doc.text(`MyFamilyExpenses · ${report.household.name}`, left, y, { lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, left, y, {
      width,
      align: "right",
      lineBreak: false,
    });

    doc.page.margins.bottom = savedBottom;
  }
}

// ── Entry point ──────────────────────────────────────────────────────────────
export function reportToPdf(report: AccountantReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: MARGIN,
      bufferPages: true,
      info: {
        Title: `Monthly Expense Report - ${report.household.name}`,
        Author: "MyFamilyExpenses",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    drawHeader(doc, report);
    drawSummaryCards(doc, report);
    drawBreakdowns(doc, report);

    drawSectionTitle(doc, "Monthly totals");
    drawSimpleTable(
      doc,
      [
        { label: "Month", width: contentWidth(doc) - 120 - 80, value: (r: AccountantReport["monthlyTotals"][number]) => r.month },
        { label: "Total", width: 120, align: "right", value: (r) => formatCurrency(r.total) },
        { label: "Count", width: 80, align: "right", value: (r) => String(r.count) },
      ],
      report.monthlyTotals,
      "No monthly totals in this period.",
    );

    drawExpenseRegister(doc, report);

    drawFooter(doc, report);
    doc.end();
  });
}
