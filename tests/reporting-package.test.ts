import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import { inflateRawSync } from "node:zlib";
import test from "node:test";
import type { AccountantReport } from "../lib/reporting";
import {
  accountantPackageStream,
  planAccountantPackage,
  receiptPackagePath,
} from "../lib/reporting/export-package";

type Expense = AccountantReport["expenses"][number];

function expense(overrides: Partial<Expense>): Expense {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    invoiceNumber: "INV-001",
    invoiceDate: new Date("2026-06-02T00:00:00.000Z"),
    amountCents: 12345,
    taxCents: 1605,
    currency: "CAD",
    vendor: "Paper Depot",
    paymentMethod: "CREDIT",
    notes: null,
    isBusiness: true,
    categoryId: "category-id",
    categoryName: "Office supplies",
    userId: "user-id",
    userName: "Taylor User",
    enteredByUserId: "entered-by-id",
    enteredByUserName: "Jordan Uploader",
    filePath: "uploads/present.jpg",
    ...overrides,
  };
}

function report(expenses: Expense[]): AccountantReport {
  return {
    household: { id: "household-id", name: "Family & Co" },
    range: {
      from: new Date("2026-01-01T00:00:00.000Z"),
      to: new Date("2026-12-31T00:00:00.000Z"),
    },
    generatedAt: new Date("2026-12-31T12:00:00.000Z"),
    filters: { period: "year" },
    totals: { totalCents: 12345, count: expenses.length, averageCents: 12345 },
    categoryBreakdown: [],
    memberBreakdown: [],
    monthlyTotals: [],
    expenses,
  };
}

async function collect(stream: Readable) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

// Read entries through the central directory: yazl writes data descriptors,
// so sizes in the local headers are not reliable.
function readZip(zip: Buffer) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, "end of central directory record");
  const count = zip.readUInt16LE(end + 10);
  let cursor = zip.readUInt32LE(end + 16);
  const entries = new Map<string, Buffer>();
  for (let i = 0; i < count; i += 1) {
    assert.equal(zip.readUInt32LE(cursor), 0x02014b50);
    const method = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = zip.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test("receipt names in the package carry date, vendor, amount and a short id", () => {
  assert.equal(
    receiptPackagePath(expense({ vendor: "Café Ünïcode / Co." })),
    "receipts/2026-06-02_cafe-unicode-co_123.45_11111111.jpg",
  );
  // No vendor: fall back to the category name.
  assert.equal(
    receiptPackagePath(expense({ vendor: null, filePath: "uploads/x.PDF" })),
    "receipts/2026-06-02_office-supplies_123.45_11111111.pdf",
  );
});

test("package ZIP holds receipts, index, summary and README, and lists missing files", async () => {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), "mfe-package-"));
  const previousUploadDir = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = uploadDir;
  try {
    const receiptBytes = Buffer.from("fake jpeg bytes for the package test");
    await writeFile(path.join(uploadDir, "present.jpg"), receiptBytes);

    const plan = await planAccountantPackage(
      report([
        expense({}),
        expense({
          id: "99999999-0000-0000-0000-000000000000",
          invoiceNumber: "INV-002",
          vendor: "Gone Store",
          filePath: "uploads/missing.png",
        }),
      ]),
    );

    assert.equal(plan.receipts.length, 1);
    assert.equal(plan.missing.length, 1);
    assert.equal(plan.missing[0].storedPath, "uploads/missing.png");

    const entries = readZip(await collect(await accountantPackageStream(plan)));
    const receiptName = "receipts/2026-06-02_paper-depot_123.45_11111111.jpg";

    assert.deepEqual(
      [...entries.keys()].sort(),
      ["README.txt", "index.csv", "index.xlsx", receiptName, "summary.pdf"].sort(),
    );
    assert.deepEqual(entries.get(receiptName), receiptBytes);
    assert.ok(entries.get("summary.pdf")!.subarray(0, 5).equals(Buffer.from("%PDF-")));

    const csv = entries.get("index.csv")!.toString("utf8");
    assert.ok(csv.includes(receiptName), "index points at the file inside the package");
    assert.ok(csv.includes("INV-002"), "expense with a missing file stays in the index");
    assert.ok(csv.includes("(file missing)"));
    assert.ok(!csv.includes("uploads/"), "server storage paths do not leak into the index");

    const readme = entries.get("README.txt")!.toString("utf8");
    assert.match(readme, /Receipt files included: 1/);
    assert.match(readme, /Receipt files missing: 1/);
    assert.match(readme, /gone-store/);
  } finally {
    if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousUploadDir;
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test("stored paths cannot reach outside the upload directory", async () => {
  const seen: string[] = [];
  await planAccountantPackage(
    report([expense({ filePath: "../../etc/passwd" })]),
    async (absolutePath) => {
      seen.push(absolutePath);
      return false;
    },
  );
  assert.equal(path.basename(seen[0]), "passwd");
  assert.ok(!seen[0].includes(".."));
});
