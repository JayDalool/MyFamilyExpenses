import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  computeFileSha256,
  consumeExtractionAttempt,
  createExtractionAttempt,
} from "../lib/ocr/extraction-attempt";
import { recordCorrectionFeedback } from "../lib/ocr/correction-feedback";
import { parseInvoiceFieldsFromText } from "../lib/ocr/ocr-parsing";
import type { OcrExtractionEnvelope } from "../lib/ocr/types";
import { assertSafeTestDatabase } from "./helpers/test-database";

const testDatabaseUrl = assertSafeTestDatabase();
const db = new PrismaClient({ datasourceUrl: testDatabaseUrl });

after(async () => {
  await db.$disconnect();
});

async function makeMember() {
  const user = await db.user.create({
    data: { name: "Phase C", email: `phase-c-${crypto.randomUUID()}@example.com` },
  });
  const household = await db.household.create({
    data: { name: `Phase C ${crypto.randomUUID()}` },
  });
  await db.membership.create({
    data: { userId: user.id, householdId: household.id, role: "OWNER" },
  });
  const category = await db.category.create({
    data: { householdId: household.id, name: `Cat ${crypto.randomUUID()}` },
  });
  return { user, household, category };
}

async function makeExpense(
  member: Awaited<ReturnType<typeof makeMember>>,
  final: { invoiceNumber: string; invoiceDate: string; amount: string },
) {
  return db.expense.create({
    data: {
      userId: member.user.id,
      paidByUserId: member.user.id,
      householdId: member.household.id,
      categoryId: member.category.id,
      invoiceNumber: final.invoiceNumber,
      invoiceDate: new Date(`${final.invoiceDate}T00:00:00.000Z`),
      amount: final.amount,
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

/** Create + consume an attempt linked to a fresh expense, then return both. */
async function linkedAttemptAndExpense(
  rawText: string,
  final: { invoiceNumber: string; invoiceDate: string; amount: string },
) {
  const member = await makeMember();
  const fileSha256 = computeFileSha256(sampleBytes);
  const attemptId = await createExtractionAttempt({
    userId: member.user.id,
    householdId: member.household.id,
    fileSha256,
    fileBytes: sampleBytes,
    envelope: buildEnvelope(rawText),
  });
  assert.ok(attemptId);
  const expense = await makeExpense(member, final);
  const linked = await consumeExtractionAttempt({
    attemptId: attemptId!,
    userId: member.user.id,
    householdId: member.household.id,
    fileSha256,
    expenseId: expense.id,
  });
  assert.equal(linked, true);
  return { member, attemptId: attemptId!, expense, fileSha256 };
}

test("feedback row is created for a valid linked attempt and is tenant-scoped", async () => {
  const ctx = await linkedAttemptAndExpense(
    "Total 84.80\nDate 2018-01-01\nCard 4111 1111 1111 1111",
    { invoiceNumber: "INV-1", invoiceDate: "2018-01-01", amount: "84.80" },
  );

  const ok = await recordCorrectionFeedback({
    attemptId: ctx.attemptId,
    expenseId: ctx.expense.id,
    userId: ctx.member.user.id,
    householdId: ctx.member.household.id,
    final: {
      invoiceNumber: "INV-1",
      invoiceDate: "2018-01-01",
      amount: 84.8,
      categoryId: ctx.member.category.id,
      paidByUserId: ctx.member.user.id,
    },
  });
  assert.equal(ok, true);

  const row = await db.receiptCorrectionFeedback.findUnique({
    where: { expenseId: ctx.expense.id },
  });
  assert.ok(row);
  assert.equal(row!.userId, ctx.member.user.id);
  assert.equal(row!.householdId, ctx.member.household.id);
  assert.equal(row!.attemptId, ctx.attemptId);
  assert.equal(row!.finalAmount.toString(), "84.8");
  // Predicted amount matched final → not changed.
  assert.equal(row!.amountChanged, false);
  // Durable row must never carry raw OCR text or card digits.
  assert.doesNotMatch(JSON.stringify(row), /4111/);
});

test("amountChanged is true when the user saved a different amount", async () => {
  const ctx = await linkedAttemptAndExpense(
    "Total 84.80\nDate 2018-01-01",
    { invoiceNumber: "INV-2", invoiceDate: "2018-01-01", amount: "99.99" },
  );

  const ok = await recordCorrectionFeedback({
    attemptId: ctx.attemptId,
    expenseId: ctx.expense.id,
    userId: ctx.member.user.id,
    householdId: ctx.member.household.id,
    final: {
      invoiceNumber: "INV-2",
      invoiceDate: "2018-01-01",
      amount: 99.99,
      categoryId: ctx.member.category.id,
      paidByUserId: ctx.member.user.id,
    },
  });
  assert.equal(ok, true);

  const row = await db.receiptCorrectionFeedback.findUnique({
    where: { expenseId: ctx.expense.id },
  });
  assert.equal(row!.amountChanged, true);
  assert.equal(row!.finalAmount.toString(), "99.99");
});

test("no feedback is written when the attempt was never linked to the expense", async () => {
  const member = await makeMember();
  const fileSha256 = computeFileSha256(sampleBytes);
  // Attempt is created but deliberately NOT consumed/linked.
  const attemptId = await createExtractionAttempt({
    userId: member.user.id,
    householdId: member.household.id,
    fileSha256,
    fileBytes: sampleBytes,
    envelope: buildEnvelope("Total 5.00\nDate 2018-01-01"),
  });
  const expense = await makeExpense(member, {
    invoiceNumber: "INV-3",
    invoiceDate: "2018-01-01",
    amount: "5.00",
  });

  const ok = await recordCorrectionFeedback({
    attemptId: attemptId!,
    expenseId: expense.id,
    userId: member.user.id,
    householdId: member.household.id,
    final: {
      invoiceNumber: "INV-3",
      invoiceDate: "2018-01-01",
      amount: 5,
      categoryId: member.category.id,
      paidByUserId: member.user.id,
    },
  });
  assert.equal(ok, false);

  const row = await db.receiptCorrectionFeedback.findUnique({
    where: { expenseId: expense.id },
  });
  assert.equal(row, null);
});

test("feedback cannot be recorded by another household", async () => {
  const ctx = await linkedAttemptAndExpense("Total 7.00\nDate 2018-01-01", {
    invoiceNumber: "INV-4",
    invoiceDate: "2018-01-01",
    amount: "7.00",
  });
  const other = await makeMember();

  const ok = await recordCorrectionFeedback({
    attemptId: ctx.attemptId,
    expenseId: ctx.expense.id,
    userId: other.user.id,
    householdId: other.household.id,
    final: {
      invoiceNumber: "INV-4",
      invoiceDate: "2018-01-01",
      amount: 7,
      categoryId: other.category.id,
      paidByUserId: other.user.id,
    },
  });
  assert.equal(ok, false);

  const row = await db.receiptCorrectionFeedback.findUnique({
    where: { expenseId: ctx.expense.id },
  });
  assert.equal(row, null);
});

test("feedback survives cleanup of its source attempt (FK SetNull)", async () => {
  const ctx = await linkedAttemptAndExpense("Total 12.00\nDate 2018-01-01", {
    invoiceNumber: "INV-5",
    invoiceDate: "2018-01-01",
    amount: "12.00",
  });
  await recordCorrectionFeedback({
    attemptId: ctx.attemptId,
    expenseId: ctx.expense.id,
    userId: ctx.member.user.id,
    householdId: ctx.member.household.id,
    final: {
      invoiceNumber: "INV-5",
      invoiceDate: "2018-01-01",
      amount: 12,
      categoryId: ctx.member.category.id,
      paidByUserId: ctx.member.user.id,
    },
  });

  // Simulate the short-lived attempt being purged by the cleanup job.
  await db.receiptExtractionAttempt.delete({ where: { id: ctx.attemptId } });

  const row = await db.receiptCorrectionFeedback.findUnique({
    where: { expenseId: ctx.expense.id },
  });
  assert.ok(row, "feedback must outlive its attempt");
  assert.equal(row!.attemptId, null, "attemptId is nulled, not cascaded away");
});
