import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createEmptyOcrResult } from "../lib/ocr/ocr-parsing";
import type { OcrInput } from "../lib/ocr/types";
import { benchmarkSavedExpenses } from "../scripts/ocr-bench/real";
import { assertSafeTestDatabase } from "./helpers/test-database";
import { money } from "./helpers/expense-money";

const testDatabaseUrl = assertSafeTestDatabase();
const db = new PrismaClient({ datasourceUrl: testDatabaseUrl });

before(async () => {
  await db.$connect();
});

after(async () => {
  await db.$disconnect();
});

async function createFixture(uploadDir: string) {
  const [inScope, outOfScope] = await Promise.all([
    db.user.create({ data: { name: "Bench In", email: `bench-in-${crypto.randomUUID()}@example.com` } }),
    db.user.create({ data: { name: "Bench Out", email: `bench-out-${crypto.randomUUID()}@example.com` } }),
  ]);
  const household = await db.household.create({ data: { name: `Bench ${crypto.randomUUID()}` } });
  await db.membership.createMany({
    data: [
      { userId: inScope.id, householdId: household.id, role: "OWNER" },
      { userId: outOfScope.id, householdId: household.id, role: "MEMBER" },
    ],
  });
  const category = await db.category.create({
    data: { householdId: household.id, name: `Bench ${crypto.randomUUID()}` },
  });

  const base = { householdId: household.id, categoryId: category.id, invoiceDate: new Date("2026-03-14T00:00:00.000Z") };
  const imageName = `${crypto.randomUUID()}.jpg`;
  await writeFile(path.join(uploadDir, imageName), Buffer.from("not really a jpeg"));

  await db.expense.createMany({
    data: [
      // Scored: image on disk, entered by the in-scope user.
      { ...base, userId: inScope.id, paidByUserId: inScope.id, invoiceNumber: "IMG", ...money(20.97), taxCents: 58, vendor: "Northgate", filePath: `uploads/${imageName}` },
      // Skipped: PDF, and an image whose file is gone.
      { ...base, userId: inScope.id, paidByUserId: inScope.id, invoiceNumber: "PDF", ...money(5), filePath: "uploads/bill.pdf" },
      { ...base, userId: inScope.id, paidByUserId: inScope.id, invoiceNumber: "GONE", ...money(5), filePath: "uploads/gone.png" },
      // Never read: deleted, and entered by someone outside the scope.
      { ...base, userId: inScope.id, paidByUserId: inScope.id, invoiceNumber: "DEL", ...money(5), filePath: `uploads/${imageName}`, deletedAt: new Date() },
      { ...base, userId: outOfScope.id, paidByUserId: outOfScope.id, invoiceNumber: "OUT", ...money(5), filePath: `uploads/${imageName}` },
    ],
  });

  return { inScope, outOfScope, household };
}

test("saved-expense benchmark reads only the chosen user's live expenses", async () => {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), "mfe-bench-"));
  const previousUploadDir = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = uploadDir;
  const fixture = await createFixture(uploadDir);
  try {
    const calls: OcrInput[] = [];
    const run = await benchmarkSavedExpenses(
      { emails: [fixture.inScope.email], householdIds: [], limit: 50 },
      db,
      async (input) => {
        calls.push(input);
        return { ...createEmptyOcrResult("fake"), amount: 20.97, invoiceDate: "2026-03-14", merchant: "NORTHGATE FRESH MARKET" };
      },
    );

    assert.equal(run.matched, 3, "deleted and out-of-scope expenses are not matched");
    assert.equal(run.pdfSkipped, 1);
    assert.equal(run.fileMissing, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].fileName, "receipt", "the stored file name is not passed on");
    assert.equal(run.overall.fields.amount.correct, 1);
    assert.equal(run.overall.fields.date.correct, 1);
    assert.equal(run.overall.fields.vendor.correct, 1);
    assert.equal(run.overall.fields.tax.unsupported, 1);

    // A household scope includes every member's live expenses.
    const householdRun = await benchmarkSavedExpenses(
      { emails: [], householdIds: [fixture.household.id], limit: 50 },
      db,
      async () => createEmptyOcrResult("fake"),
    );
    assert.equal(householdRun.matched, 4);

    await assert.rejects(
      benchmarkSavedExpenses({ emails: ["nobody@example.invalid"], householdIds: [], limit: 5 }, db),
      /Found 0 of 1 users/,
    );
  } finally {
    if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousUploadDir;
    await db.household.delete({ where: { id: fixture.household.id } });
    await db.user.deleteMany({ where: { id: { in: [fixture.inScope.id, fixture.outOfScope.id] } } });
    await rm(uploadDir, { recursive: true, force: true });
  }
});
