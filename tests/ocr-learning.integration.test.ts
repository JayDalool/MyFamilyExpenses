import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { getHouseholdLearningInsights } from "../lib/ocr/learning-insights";
import { assertSafeTestDatabase } from "./helpers/test-database";

const testDatabaseUrl = assertSafeTestDatabase();
const db = new PrismaClient({ datasourceUrl: testDatabaseUrl });

after(async () => {
  await db.$disconnect();
});

async function makeMember() {
  const user = await db.user.create({
    data: { name: "Phase D", email: `phase-d-${crypto.randomUUID()}@example.com` },
  });
  const household = await db.household.create({
    data: { name: `Phase D ${crypto.randomUUID()}` },
  });
  await db.membership.create({
    data: { userId: user.id, householdId: household.id, role: "OWNER" },
  });
  const category = await db.category.create({
    data: { householdId: household.id, name: `Cat ${crypto.randomUUID()}` },
  });
  return { user, household, category };
}

async function makeFeedback(
  member: Awaited<ReturnType<typeof makeMember>>,
  over: { amountChanged?: boolean; merchantGuess?: string; receiptType?: string } = {},
) {
  const expense = await db.expense.create({
    data: {
      userId: member.user.id,
      paidByUserId: member.user.id,
      householdId: member.household.id,
      categoryId: member.category.id,
      invoiceNumber: `INV-${crypto.randomUUID().slice(0, 8)}`,
      invoiceDate: new Date("2024-03-14T00:00:00.000Z"),
      amount: "20.00",
      filePath: `uploads/${crypto.randomUUID()}.png`,
    },
  });
  return db.receiptCorrectionFeedback.create({
    data: {
      userId: member.user.id,
      householdId: member.household.id,
      expenseId: expense.id,
      attemptId: null,
      receiptType: over.receiptType ?? "retail",
      merchantGuess: over.merchantGuess ?? "Example Retail Co",
      parserVersion: "stage-a3",
      provider: "paddle",
      strategy: "ensemble",
      providersUsed: ["paddle"],
      invoiceNumberChanged: false,
      invoiceDateChanged: false,
      amountChanged: over.amountChanged ?? false,
      predictedAmount: "20.00",
      finalAmount: "20.00",
      warnings: [],
      candidatesSummary: {},
    },
  });
}

test("learning insights are strictly household-scoped", async () => {
  const a = await makeMember();
  const b = await makeMember();
  await makeFeedback(a, { amountChanged: true });
  await makeFeedback(a, { amountChanged: false });
  await makeFeedback(b, { amountChanged: true });

  const insightsA = await getHouseholdLearningInsights(a.household.id);
  const insightsB = await getHouseholdLearningInsights(b.household.id);

  assert.equal(insightsA.totalRecords, 2);
  assert.equal(insightsA.amountCorrectionRate.changed, 1);
  assert.equal(insightsA.amountCorrectionRate.rate, 0.5);

  assert.equal(insightsB.totalRecords, 1);
  assert.equal(insightsB.amountCorrectionRate.changed, 1);
  assert.equal(insightsB.amountCorrectionRate.rate, 1);
});

test("empty household yields the safe empty insights", async () => {
  const empty = await makeMember();
  const insights = await getHouseholdLearningInsights(empty.household.id);
  assert.equal(insights.totalRecords, 0);
  assert.deepEqual(insights.merchants, []);
  assert.deepEqual(insights.recentExamples, []);
});
