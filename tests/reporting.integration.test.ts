import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  deleteOrDisableCategoryForHousehold,
  updateCategoryForHousehold,
} from "../lib/categories";
import {
  softDeleteExpenseForUser,
  updateExpenseForUser,
} from "../lib/expenses";
import { getDashboardSummary, getReportData, normalizeReportFilters } from "../lib/reporting";
import type { AuthContext } from "../lib/auth/session";
import { assertSafeTestDatabase } from "./helpers/test-database";

const testDatabaseUrl = assertSafeTestDatabase();
const integrationTest = test;
const db = new PrismaClient({ datasourceUrl: testDatabaseUrl });
const referenceDate = new Date("2026-06-07T12:00:00.000Z");

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture() {
  const [userA, userB] = await Promise.all([
    db.user.create({
      data: { name: "Reports A", email: `reports-a-${crypto.randomUUID()}@example.com` },
    }),
    db.user.create({
      data: { name: "Reports B", email: `reports-b-${crypto.randomUUID()}@example.com` },
    }),
  ]);
  const [householdA, householdB] = await Promise.all([
    db.household.create({ data: { name: `Reports A ${crypto.randomUUID()}` } }),
    db.household.create({ data: { name: `Reports B ${crypto.randomUUID()}` } }),
  ]);
  await db.membership.createMany({
    data: [
      { userId: userA.id, householdId: householdA.id, role: "OWNER" },
      { userId: userA.id, householdId: householdB.id, role: "MEMBER" },
      { userId: userB.id, householdId: householdB.id, role: "OWNER" },
    ],
  });
  const [usedCategoryA, unusedCategoryA, categoryB] = await Promise.all([
    db.category.create({
      data: { householdId: householdA.id, name: `Used A ${crypto.randomUUID()}` },
    }),
    db.category.create({
      data: { householdId: householdA.id, name: `Unused A ${crypto.randomUUID()}` },
    }),
    db.category.create({
      data: { householdId: householdB.id, name: `Used B ${crypto.randomUUID()}` },
    }),
  ]);

  const expenseData = [
    ["A-TODAY", "2026-06-07", 10],
    ["A-WEEK", "2026-06-06", 20],
    ["A-MONTH", "2026-06-02", 30],
    ["A-YEAR", "2026-01-15", 40],
    ["A-OLD", "2025-12-31", 50],
  ] as const;
  const expensesA = await Promise.all(
    expenseData.map(([invoiceNumber, invoiceDate, amount]) =>
      db.expense.create({
        data: {
          userId: userA.id,
          householdId: householdA.id,
          categoryId: usedCategoryA.id,
          invoiceNumber,
          invoiceDate: new Date(`${invoiceDate}T00:00:00.000Z`),
          amount,
          filePath: `uploads/${invoiceNumber}.pdf`,
        },
      }),
    ),
  );
  await db.expense.create({
    data: {
      userId: userA.id,
      householdId: householdA.id,
      categoryId: usedCategoryA.id,
      invoiceNumber: "A-DELETED",
      invoiceDate: new Date("2026-06-07T00:00:00.000Z"),
      amount: 999,
      filePath: "uploads/deleted.pdf",
      deletedAt: new Date(),
      deletedByUserId: userA.id,
    },
  });
  await db.expense.create({
    data: {
      userId: userB.id,
      householdId: householdB.id,
      categoryId: categoryB.id,
      invoiceNumber: "B-TODAY",
      invoiceDate: new Date("2026-06-07T00:00:00.000Z"),
      amount: 100,
      filePath: "uploads/b.pdf",
    },
  });

  const households = [
    { id: householdA.id, name: householdA.name, role: "OWNER" as const },
    { id: householdB.id, name: householdB.name, role: "MEMBER" as const },
  ];
  const authA: AuthContext = {
    user: { id: userA.id, name: userA.name, email: userA.email, role: userA.role },
    householdId: householdA.id,
    householdName: householdA.name,
    householdRole: "OWNER",
    households,
  };
  const authB: AuthContext = {
    ...authA,
    householdId: householdB.id,
    householdName: householdB.name,
    householdRole: "MEMBER",
  };

  return {
    userA,
    userB,
    householdA,
    householdB,
    usedCategoryA,
    unusedCategoryA,
    categoryB,
    expensesA,
    authA,
    authB,
  };
}

async function cleanupFixture(fixture: Fixture) {
  assertSafeTestDatabase();
  const householdIds = [fixture.householdA.id, fixture.householdB.id];
  const userIds = [fixture.userA.id, fixture.userB.id];

  await db.auditLog.deleteMany({
    where: { OR: [{ householdId: { in: householdIds } }, { userId: { in: userIds } }] },
  });
  await db.expense.deleteMany({ where: { householdId: { in: householdIds } } });
  await db.category.deleteMany({ where: { householdId: { in: householdIds } } });
  await db.membership.deleteMany({ where: { householdId: { in: householdIds } } });
  await db.household.deleteMany({ where: { id: { in: householdIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
}

before(async () => {
  await db?.$connect();
});

after(async () => {
  await db?.$disconnect();
});

integrationTest("dashboard totals are date-bounded, active-only, and household-scoped", async () => {
  const fixture = await createFixture();
  try {
    const dashboardA = await getDashboardSummary(fixture.householdA.id, db!, referenceDate);
    const dashboardB = await getDashboardSummary(fixture.householdB.id, db!, referenceDate);

    assert.equal(dashboardA.today._sum.amount?.toString(), "10");
    assert.equal(dashboardA.month._sum.amount?.toString(), "60");
    assert.equal(dashboardA.allTime._sum.amount?.toString(), "150");
    assert.equal(dashboardA.allTime._count._all, 5);
    assert.equal(dashboardB.today._sum.amount?.toString(), "100");
    assert.equal(dashboardB.allTime._count._all, 1);
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("dashboard totals reflect expense create, edit, and soft delete", async () => {
  const fixture = await createFixture();
  try {
    const created = await db!.expense.create({
      data: {
        userId: fixture.userA.id,
        householdId: fixture.householdA.id,
        categoryId: fixture.usedCategoryA.id,
        invoiceNumber: "A-MUTATION",
        invoiceDate: new Date("2026-06-07T00:00:00.000Z"),
        amount: 5,
        filePath: "uploads/mutation.pdf",
      },
    });
    assert.equal(
      (await getDashboardSummary(fixture.householdA.id, db!, referenceDate)).allTime._sum.amount?.toString(),
      "155",
    );

    await updateExpenseForUser(fixture.authA, created.id, { amount: 8 }, db!);
    assert.equal(
      (await getDashboardSummary(fixture.householdA.id, db!, referenceDate)).today._sum.amount?.toString(),
      "18",
    );

    await softDeleteExpenseForUser(fixture.authA, created.id, fixture.userA.id, db!);
    assert.equal(
      (await getDashboardSummary(fixture.householdA.id, db!, referenceDate)).allTime._sum.amount?.toString(),
      "150",
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("reports match active household totals and exclude soft-deleted expenses", async () => {
  const fixture = await createFixture();
  try {
    const monthFilters = normalizeReportFilters({ period: "month", pageSize: "2" });
    const [reportA, reportB] = await Promise.all([
      getReportData(fixture.householdA.id, monthFilters, db!, referenceDate),
      getReportData(fixture.householdB.id, monthFilters, db!, referenceDate),
    ]);

    assert.equal(reportA.summary.total?.toString(), "60");
    assert.equal(reportA.summary.count, 3);
    assert.equal(reportA.summary.average?.toString(), "20");
    assert.equal(reportA.pagination.total, 3);
    assert.equal(reportA.expenses.length, 2);
    assert.equal(reportB.summary.total?.toString(), "100");
    assert.equal(reportB.summary.count, 1);
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("category update/delete stays scoped and disables categories that have expenses", async () => {
  const fixture = await createFixture();
  try {
    const renamed = await updateCategoryForHousehold(
      fixture.householdA.id,
      fixture.unusedCategoryA.id,
      { name: "Renamed unused" },
      db!,
    );
    const crossUpdate = await updateCategoryForHousehold(
      fixture.householdB.id,
      fixture.unusedCategoryA.id,
      { name: "Cross household" },
      db!,
    );
    const crossDelete = await deleteOrDisableCategoryForHousehold(
      fixture.householdB.id,
      fixture.unusedCategoryA.id,
      db!,
    );
    const unusedDelete = await deleteOrDisableCategoryForHousehold(
      fixture.householdA.id,
      fixture.unusedCategoryA.id,
      db!,
    );
    const usedDelete = await deleteOrDisableCategoryForHousehold(
      fixture.householdA.id,
      fixture.usedCategoryA.id,
      db!,
    );

    assert.equal(renamed?.name, "Renamed unused");
    assert.equal(crossUpdate, null);
    assert.equal(crossDelete, null);
    assert.equal(unusedDelete?.mode, "deleted");
    assert.equal(
      await db!.category.findUnique({ where: { id: fixture.unusedCategoryA.id } }),
      null,
    );
    assert.equal(usedDelete?.mode, "disabled");
    assert.equal(usedDelete?.category.status, "DISABLED");
    assert.ok(usedDelete!.expenseCount > 0);
  } finally {
    await cleanupFixture(fixture);
  }
});
