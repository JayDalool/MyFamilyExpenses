import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  computeFileSha256,
  consumeExtractionAttempt,
  createExtractionAttempt,
  deleteStaleExtractionAttempts,
} from "../lib/ocr/extraction-attempt";
import { parseInvoiceFieldsFromText } from "../lib/ocr/ocr-parsing";
import type { OcrExtractionEnvelope } from "../lib/ocr/types";
import { assertSafeTestDatabase } from "./helpers/test-database";

const testDatabaseUrl = assertSafeTestDatabase();
const db = new PrismaClient({ datasourceUrl: testDatabaseUrl });

after(async () => {
  await db.$disconnect();
});

async function makeMember(role: "OWNER" = "OWNER") {
  const user = await db.user.create({
    data: { name: "Phase B", email: `phase-b-${crypto.randomUUID()}@example.com` },
  });
  const household = await db.household.create({
    data: { name: `Phase B ${crypto.randomUUID()}` },
  });
  await db.membership.create({
    data: { userId: user.id, householdId: household.id, role },
  });
  const category = await db.category.create({
    data: { householdId: household.id, name: `Cat ${crypto.randomUUID()}` },
  });
  return { user, household, category };
}

async function makeExpense(member: Awaited<ReturnType<typeof makeMember>>) {
  return db.expense.create({
    data: {
      userId: member.user.id,
      paidByUserId: member.user.id,
      householdId: member.household.id,
      categoryId: member.category.id,
      invoiceNumber: `INV-${crypto.randomUUID().slice(0, 8)}`,
      invoiceDate: new Date("2018-01-01T00:00:00.000Z"),
      amount: "84.80",
      filePath: `uploads/${crypto.randomUUID()}.png`,
    },
  });
}

function buildEnvelope(rawText: string): OcrExtractionEnvelope {
  const parserResult = parseInvoiceFieldsFromText(rawText, "paddle", 0.9);
  const engineResult = {
    rawText,
    blocks: [],
    meanScore: 0.9,
    provider: "paddle",
    modelVersion: "test-1",
    durationMs: 123,
  };
  return { engineResult, parserResult, response: parserResult };
}

const sampleBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

test("extraction creates a tenant-scoped attempt with redacted raw text", async () => {
  const member = await makeMember();
  const envelope = buildEnvelope("Total 84.80\nDate 2018-01-01\nCard 4111 1111 1111 1111");
  const fileSha256 = computeFileSha256(sampleBytes);

  const attemptId = await createExtractionAttempt({
    userId: member.user.id,
    householdId: member.household.id,
    fileSha256,
    fileBytes: sampleBytes,
    envelope,
  });
  assert.ok(attemptId);

  const row = await db.receiptExtractionAttempt.findUnique({ where: { id: attemptId! } });
  assert.ok(row);
  assert.equal(row!.userId, member.user.id);
  assert.equal(row!.householdId, member.household.id);
  assert.equal(row!.consumedAt, null);
  assert.ok(row!.expiresAt.getTime() > Date.now());
  // Card number must be redacted out of stored raw text.
  assert.doesNotMatch(row!.rawText ?? "", /4111/);
});

test("an attempt cannot be consumed by another household", async () => {
  const owner = await makeMember();
  const other = await makeMember();
  const fileSha256 = computeFileSha256(sampleBytes);
  const attemptId = await createExtractionAttempt({
    userId: owner.user.id,
    householdId: owner.household.id,
    fileSha256,
    fileBytes: sampleBytes,
    envelope: buildEnvelope("Total 5.00\nDate 2018-01-01"),
  });
  const expense = await makeExpense(other);

  const claimed = await consumeExtractionAttempt({
    attemptId: attemptId!,
    userId: other.user.id,
    householdId: other.household.id,
    fileSha256,
    expenseId: expense.id,
  });
  assert.equal(claimed, false);

  const row = await db.receiptExtractionAttempt.findUnique({ where: { id: attemptId! } });
  assert.equal(row!.consumedAt, null);
});

test("an expired attempt cannot be consumed", async () => {
  const member = await makeMember();
  const expense = await makeExpense(member);
  const fileSha256 = computeFileSha256(sampleBytes);

  const expired = await db.receiptExtractionAttempt.create({
    data: {
      userId: member.user.id,
      householdId: member.household.id,
      fileSha256,
      provider: "paddle",
      strategy: "single",
      providersUsed: ["paddle"],
      modelVersions: ["test-1"],
      parserVersion: "stage-a3",
      candidates: { invoiceNumber: [], invoiceDate: [], amount: [], merchant: [] },
      selectedExtraction: {},
      warnings: [],
      receiptType: "retail",
      imageQuality: {},
      confidence: { invoiceNumber: 0, invoiceDate: 0, amount: 0 },
      durationMs: 1,
      expiresAt: new Date(Date.now() - 60_000), // already expired
    },
  });

  const claimed = await consumeExtractionAttempt({
    attemptId: expired.id,
    userId: member.user.id,
    householdId: member.household.id,
    fileSha256,
    expenseId: expense.id,
  });
  assert.equal(claimed, false);
});

test("a consumed attempt cannot be reused", async () => {
  const member = await makeMember();
  const fileSha256 = computeFileSha256(sampleBytes);
  const attemptId = await createExtractionAttempt({
    userId: member.user.id,
    householdId: member.household.id,
    fileSha256,
    fileBytes: sampleBytes,
    envelope: buildEnvelope("Total 9.99\nDate 2018-01-01"),
  });
  const expenseA = await makeExpense(member);
  const expenseB = await makeExpense(member);

  const first = await consumeExtractionAttempt({
    attemptId: attemptId!,
    userId: member.user.id,
    householdId: member.household.id,
    fileSha256,
    expenseId: expenseA.id,
  });
  assert.equal(first, true);

  const second = await consumeExtractionAttempt({
    attemptId: attemptId!,
    userId: member.user.id,
    householdId: member.household.id,
    fileSha256,
    expenseId: expenseB.id,
  });
  assert.equal(second, false);

  const row = await db.receiptExtractionAttempt.findUnique({ where: { id: attemptId! } });
  assert.equal(row!.consumedByExpenseId, expenseA.id);
  assert.ok(row!.consumedAt);
});

test("consume fails when the uploaded file hash does not match", async () => {
  const member = await makeMember();
  const expense = await makeExpense(member);
  const attemptId = await createExtractionAttempt({
    userId: member.user.id,
    householdId: member.household.id,
    fileSha256: computeFileSha256(sampleBytes),
    fileBytes: sampleBytes,
    envelope: buildEnvelope("Total 1.00\nDate 2018-01-01"),
  });

  const claimed = await consumeExtractionAttempt({
    attemptId: attemptId!,
    userId: member.user.id,
    householdId: member.household.id,
    fileSha256: computeFileSha256(new Uint8Array([9, 9, 9])), // different file
    expenseId: expense.id,
  });
  assert.equal(claimed, false);
});

test("cleanup deletes expired and consumed attempts", async () => {
  const member = await makeMember();
  const fileSha256 = computeFileSha256(sampleBytes);
  await db.receiptExtractionAttempt.create({
    data: {
      userId: member.user.id,
      householdId: member.household.id,
      fileSha256,
      provider: "paddle",
      strategy: "single",
      providersUsed: ["paddle"],
      modelVersions: ["test-1"],
      parserVersion: "stage-a3",
      candidates: { invoiceNumber: [], invoiceDate: [], amount: [], merchant: [] },
      selectedExtraction: {},
      warnings: [],
      receiptType: "retail",
      imageQuality: {},
      confidence: { invoiceNumber: 0, invoiceDate: 0, amount: 0 },
      durationMs: 1,
      expiresAt: new Date(Date.now() - 120_000),
    },
  });

  const result = await deleteStaleExtractionAttempts();
  assert.ok(result.count >= 1);
});
