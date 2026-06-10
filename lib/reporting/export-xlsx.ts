import { deflateRawSync } from "node:zlib";
import type { AccountantReport } from "@/lib/reporting";

// A minimal zero-dependency XLSX writer. Produces a single-sheet workbook
// using inline strings (no sharedStrings.xml). Generates a real .xlsx; the
// file is a ZIP of OOXML parts, accepted by Excel, LibreOffice, Numbers, and
// every cloud spreadsheet. Tables are formatted as text (strings) and
// numbers; no styles are applied, which keeps the writer small and the output
// portable across viewers.

type Cell = { type: "s" | "n"; value: string | number };

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function colLetter(index: number): string {
  let n = index + 1;
  let result = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function buildSheetXml(rows: Cell[][]): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  lines.push(
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
  );
  lines.push("<sheetData>");
  rows.forEach((cells, rowIndex) => {
    const rowNumber = rowIndex + 1;
    lines.push(`<row r="${rowNumber}">`);
    cells.forEach((cell, colIndex) => {
      const ref = `${colLetter(colIndex)}${rowNumber}`;
      if (cell.type === "s") {
        lines.push(
          `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(cell.value))}</t></is></c>`,
        );
      } else {
        const n = Number(cell.value);
        const safe = Number.isFinite(n) ? n : 0;
        lines.push(`<c r="${ref}"><v>${safe}</v></c>`);
      }
    });
    lines.push("</row>");
  });
  lines.push("</sheetData>");
  lines.push("</worksheet>");
  return lines.join("");
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

const WORKBOOK_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

function crc32(buffer: Buffer): number {
  let table = (crc32 as unknown as { table?: Uint32Array }).table;
  if (!table) {
    table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c >>> 0;
    }
    (crc32 as unknown as { table?: Uint32Array }).table = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (table[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

type ZipEntry = { name: string; data: Buffer };

function buildZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data, { level: 6 });
    const crc = crc32(entry.data);
    const uncompressedSize = entry.data.length;
    const compressedSize = compressed.length;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // local file header signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // general purpose
    localHeader.writeUInt16LE(8, 8); // compression: deflate
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0x21, 12); // mod date (1980-01-01)
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedSize, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const localChunk = Buffer.concat([localHeader, nameBuf, compressed]);
    localParts.push(localChunk);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // central file header signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // general purpose
    centralHeader.writeUInt16LE(8, 10); // compression: deflate
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x21, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressedSize, 20);
    centralHeader.writeUInt32LE(uncompressedSize, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra field length
    centralHeader.writeUInt16LE(0, 32); // file comment length
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(Buffer.concat([centralHeader, nameBuf]));

    offset += localChunk.length;
  }

  const centralStart = offset;
  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(centralStart, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([
    ...localParts,
    centralDirectory,
    endRecord,
  ]);
}

function s(value: string): Cell {
  return { type: "s", value };
}
function n(value: number): Cell {
  return { type: "n", value };
}

export function reportToXlsx(report: AccountantReport): Buffer {
  const rows: Cell[][] = [];
  const from = report.range.from.toISOString().slice(0, 10);
  const to = report.range.to.toISOString().slice(0, 10);

  rows.push([s("Household"), s(report.household.name)]);
  rows.push([s("Reporting period"), s(`${from} to ${to}`)]);
  rows.push([s("Generated at"), s(report.generatedAt.toISOString())]);
  rows.push([s("Total spending"), n(report.totals.total)]);
  rows.push([s("Expense count"), n(report.totals.count)]);
  rows.push([s("Average expense"), n(report.totals.average)]);
  rows.push([]);
  rows.push([s("Category breakdown")]);
  rows.push([s("Category"), s("Total"), s("Count")]);
  for (const row of report.categoryBreakdown) {
    rows.push([s(row.name), n(row.total), n(row.count)]);
  }
  rows.push([]);
  rows.push([s("Member breakdown")]);
  rows.push([s("Member"), s("Total"), s("Count")]);
  for (const row of report.memberBreakdown) {
    rows.push([s(row.name), n(row.total), n(row.count)]);
  }
  rows.push([]);
  rows.push([s("Monthly totals")]);
  rows.push([s("Month"), s("Total"), s("Count")]);
  for (const row of report.monthlyTotals) {
    rows.push([s(row.month), n(row.total), n(row.count)]);
  }
  rows.push([]);
  rows.push([s("Expense register")]);
  rows.push([
    s("Invoice number"),
    s("Invoice date"),
    s("Category"),
    s("Member"),
    s("Amount"),
    s("Receipt reference"),
  ]);
  for (const expense of report.expenses) {
    rows.push([
      s(expense.invoiceNumber),
      s(expense.invoiceDate.toISOString().slice(0, 10)),
      s(expense.categoryName),
      s(expense.userName),
      n(expense.amount),
      s(expense.filePath),
    ]);
  }

  const sheetXml = buildSheetXml(rows);
  return buildZip([
    { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES_XML, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(ROOT_RELS_XML, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(WORKBOOK_XML, "utf8") },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(WORKBOOK_RELS_XML, "utf8"),
    },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheetXml, "utf8") },
  ]);
}
