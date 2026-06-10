import type { AccountantReport } from "@/lib/reporting";

// A minimal text-only PDF writer for accountant-ready reports. Uses only the
// built-in Helvetica PDF font (no embedding) and lays out fixed-width columns
// by character count. Good enough to print, share, and archive. Not a layout
// engine, just deterministic, dependency-free output.

const PAGE_WIDTH = 612; // US Letter, points (8.5 in)
const PAGE_HEIGHT = 792; // 11 in
const MARGIN = 48;
const HEADER_SIZE = 16;
const SECTION_SIZE = 12;
const BODY_SIZE = 10;
const LINE_HEIGHT = 14;
const CONTENT_BOTTOM = MARGIN; // bottom safe margin
const CONTENT_TOP = PAGE_HEIGHT - MARGIN;

type Op = { type: "text"; size: number; font: "F1" | "F2"; text: string };

function escapePdfText(value: string): string {
  // Only Win-1252 / ASCII characters survive cleanly with the built-in
  // Helvetica encoding. Strip anything outside printable range so the PDF
  // never contains malformed bytes; substitute "?" so the layout stays
  // visually aligned.
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .split("")
    .map((c) => (c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) <= 0x7e ? c : "?"))
    .join("");
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function padRight(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value + " ".repeat(width - value.length);
}

function padLeft(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : " ".repeat(width - value.length) + value;
}

function truncate(value: string, width: number): string {
  return value.length <= width ? value : value.slice(0, width - 3) + "...";
}

class PdfBuilder {
  private pages: Op[][] = [[]];
  private cursorY = CONTENT_TOP;

  private ensureSpace(neededLines: number) {
    if (this.cursorY - neededLines * LINE_HEIGHT < CONTENT_BOTTOM) {
      this.pages.push([]);
      this.cursorY = CONTENT_TOP;
    }
  }

  text(text: string, options: { bold?: boolean; size?: number } = {}) {
    this.ensureSpace(1);
    const size = options.size ?? BODY_SIZE;
    const font = options.bold ? "F2" : "F1";
    // Wrap chunks roughly by character width; Courier-like layout works
    // well enough for accountant tables.
    const maxChars = Math.floor((PAGE_WIDTH - 2 * MARGIN) / (size * 0.45));
    const chunks = [];
    let remaining = text;
    while (remaining.length > maxChars) {
      chunks.push(remaining.slice(0, maxChars));
      remaining = remaining.slice(maxChars);
    }
    chunks.push(remaining);
    for (const chunk of chunks) {
      this.ensureSpace(1);
      this.pages[this.pages.length - 1].push({
        type: "text",
        size,
        font,
        text: chunk,
      });
      this.cursorY -= LINE_HEIGHT;
    }
  }

  blank() {
    this.cursorY -= LINE_HEIGHT;
    if (this.cursorY < CONTENT_BOTTOM) {
      this.pages.push([]);
      this.cursorY = CONTENT_TOP;
    }
    this.pages[this.pages.length - 1].push({
      type: "text",
      size: BODY_SIZE,
      font: "F1",
      text: "",
    });
  }

  build(): Buffer {
    // Object 1: Catalog. Object 2: Pages tree. Then page objects + content
    // streams pairs. Then a font object.
    const pageCount = this.pages.length;
    const objects: string[] = [];
    const xref: number[] = [];
    let buffer = "%PDF-1.4\n";

    const pushObject = (body: string) => {
      const id = objects.length + 1;
      xref.push(buffer.length);
      buffer += `${id} 0 obj\n${body}\nendobj\n`;
      objects.push(body);
      return id;
    };

    // Reserve IDs so cross-references resolve cleanly.
    const catalogId = 1;
    const pagesId = 2;
    const fontHelveticaId = 3;
    const fontHelveticaBoldId = 4;

    xref.push(buffer.length);
    buffer += `${catalogId} 0 obj\n<< /Type /Catalog /Pages ${pagesId} 0 R >>\nendobj\n`;
    objects.push("catalog");

    xref.push(buffer.length);
    const pageRefs: string[] = [];
    const pagesPlaceholderStart = buffer.length;
    // Placeholder for Pages object; we patch it after we know page IDs.
    buffer += `${pagesId} 0 obj\n<< /Type /Pages /Count ${pageCount} /Kids [%PLACEHOLDER%] >>\nendobj\n`;
    objects.push("pages");

    xref.push(buffer.length);
    buffer += `${fontHelveticaId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;
    objects.push("helvetica");

    xref.push(buffer.length);
    buffer += `${fontHelveticaBoldId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n`;
    objects.push("helveticaBold");

    for (let i = 0; i < pageCount; i += 1) {
      const ops = this.pages[i];
      const stream = this.buildStream(ops);
      const contentId = pushObject(
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      );
      const pageId = pushObject(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
          `/Resources << /Font << /F1 ${fontHelveticaId} 0 R /F2 ${fontHelveticaBoldId} 0 R >> >> ` +
          `/Contents ${contentId} 0 R >>`,
      );
      pageRefs.push(`${pageId} 0 R`);
    }

    // Patch the Pages object's Kids array.
    buffer = buffer.replace(
      "%PLACEHOLDER%",
      pageRefs.join(" "),
    );
    // Recompute the start byte of every later object because patching shifted
    // everything. (For our minimal writer this is fine; we just walk again.)
    return Buffer.from(this.assembleWithRecomputedXref(buffer, catalogId));
  }

  private buildStream(ops: Op[]): string {
    let stream = "";
    let y = CONTENT_TOP;
    let firstLine = true;
    for (const op of ops) {
      stream += "BT\n";
      stream += `/${op.font} ${op.size} Tf\n`;
      if (firstLine) {
        stream += `${MARGIN} ${y} Td\n`;
        firstLine = false;
      } else {
        stream += `${MARGIN} ${y} Td\n`;
      }
      stream += `(${escapePdfText(op.text)}) Tj\n`;
      stream += "ET\n";
      y -= LINE_HEIGHT;
    }
    return stream;
  }

  private assembleWithRecomputedXref(buffer: string, catalogId: number): string {
    // After string replacement, the byte offsets in `xref` may be wrong.
    // Recompute by scanning for `N 0 obj`.
    const positions: Record<number, number> = {};
    const regex = /(\d+) 0 obj\n/g;
    let match: RegExpExecArray | null = regex.exec(buffer);
    while (match) {
      const id = Number(match[1]);
      positions[id] = match.index;
      match = regex.exec(buffer);
    }
    const objectIds = Object.keys(positions)
      .map(Number)
      .sort((a, b) => a - b);
    const xrefStart = buffer.length;
    let xref = `xref\n0 ${objectIds.length + 1}\n0000000000 65535 f \n`;
    for (const id of objectIds) {
      xref += `${String(positions[id]).padStart(10, "0")} 00000 n \n`;
    }
    const trailer =
      `trailer\n<< /Size ${objectIds.length + 1} /Root ${catalogId} 0 R >>\n` +
      `startxref\n${xrefStart}\n%%EOF\n`;
    return buffer + xref + trailer;
  }
}

export function reportToPdf(report: AccountantReport): Buffer {
  const pdf = new PdfBuilder();
  const from = report.range.from.toISOString().slice(0, 10);
  const to = report.range.to.toISOString().slice(0, 10);

  pdf.text(`Accountant report - ${report.household.name}`, { bold: true, size: HEADER_SIZE });
  pdf.text(`Reporting period: ${from} to ${to}`);
  pdf.text(`Generated at: ${report.generatedAt.toISOString().slice(0, 19).replace("T", " ")} UTC`);
  pdf.text(`Total spending: ${formatCurrency(report.totals.total)}`);
  pdf.text(
    `Expenses: ${report.totals.count}   Average: ${formatCurrency(report.totals.average)}`,
  );
  pdf.blank();

  pdf.text("Category breakdown", { bold: true, size: SECTION_SIZE });
  pdf.text(`${padRight("Category", 40)} ${padLeft("Total", 14)} ${padLeft("Count", 8)}`, { bold: true });
  for (const row of report.categoryBreakdown) {
    pdf.text(
      `${padRight(truncate(row.name, 40), 40)} ${padLeft(formatCurrency(row.total), 14)} ${padLeft(String(row.count), 8)}`,
    );
  }
  pdf.blank();

  pdf.text("Member breakdown", { bold: true, size: SECTION_SIZE });
  pdf.text(`${padRight("Member", 40)} ${padLeft("Total", 14)} ${padLeft("Count", 8)}`, { bold: true });
  for (const row of report.memberBreakdown) {
    pdf.text(
      `${padRight(truncate(row.name, 40), 40)} ${padLeft(formatCurrency(row.total), 14)} ${padLeft(String(row.count), 8)}`,
    );
  }
  pdf.blank();

  pdf.text("Monthly totals", { bold: true, size: SECTION_SIZE });
  pdf.text(`${padRight("Month", 10)} ${padLeft("Total", 14)} ${padLeft("Count", 8)}`, { bold: true });
  for (const row of report.monthlyTotals) {
    pdf.text(
      `${padRight(row.month, 10)} ${padLeft(formatCurrency(row.total), 14)} ${padLeft(String(row.count), 8)}`,
    );
  }
  pdf.blank();

  pdf.text("Expense register", { bold: true, size: SECTION_SIZE });
  pdf.text(
    `${padRight("Date", 12)} ${padRight("Invoice", 18)} ${padRight("Category", 16)} ${padRight("Member", 14)} ${padLeft("Amount", 12)}`,
    { bold: true },
  );
  for (const expense of report.expenses) {
    pdf.text(
      `${padRight(expense.invoiceDate.toISOString().slice(0, 10), 12)} ` +
        `${padRight(truncate(expense.invoiceNumber, 18), 18)} ` +
        `${padRight(truncate(expense.categoryName, 16), 16)} ` +
        `${padRight(truncate(expense.userName, 14), 14)} ` +
        `${padLeft(formatCurrency(expense.amount), 12)}`,
    );
  }
  pdf.blank();
  pdf.text("Receipt references", { bold: true, size: SECTION_SIZE });
  for (const expense of report.expenses) {
    pdf.text(`${expense.invoiceNumber}: ${expense.filePath}`);
  }

  return pdf.build();
}
