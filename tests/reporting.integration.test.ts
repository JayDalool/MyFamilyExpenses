import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  deleteOrDisableCategoryForHousehold,
  updateCategoryForHousehold,
} from "../lib/categories";
import {
  resolvePaidByUserId,
  resolvePaidByUserIdForEdit,
  softDeleteExpenseForUser,
  updateExpenseForUser,
} from "../lib/expenses";
import {
  buildAccountantReport,
  getDashboardAnalytics,
  getDashboardSummary,
  getReportData,
  normalizeReportFilters,
} from "../lib/reporting";
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
          paidByUserId: userA.id,
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
      paidByUserId: userA.id,
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
      paidByUserId: userB.id,
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
        paidByUserId: fixture.userA.id,
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

integrationTest("accountant report applies category, member, and custom date filters", async () => {
  const fixture = await createFixture();
  await db.membership.create({
    data: { userId: fixture.userB.id, householdId: fixture.householdA.id, role: "MEMBER" },
  });
  const filteredExpense = await db.expense.create({
    data: {
      userId: fixture.userB.id,
      paidByUserId: fixture.userB.id,
      householdId: fixture.householdA.id,
      categoryId: fixture.unusedCategoryA.id,
      invoiceNumber: "A-FILTERED",
      invoiceDate: new Date("2026-06-05T00:00:00.000Z"),
      amount: 75,
      filePath: "uploads/a-filtered.pdf",
    },
  });

  try {
    const base = {
      period: "custom" as const,
      fromDate: "2026-06-01",
      toDate: "2026-06-07",
      page: 1,
      pageSize: 10,
    };
    const [all, byCategory, byMember, crossHousehold] = await Promise.all([
      buildAccountantReport(fixture.householdA, base, db!, referenceDate),
      buildAccountantReport(
        fixture.householdA,
        { ...base, categoryId: fixture.unusedCategoryA.id },
        db!,
        referenceDate,
      ),
      buildAccountantReport(
        fixture.householdA,
        { ...base, memberUserId: fixture.userB.id },
        db!,
        referenceDate,
      ),
      buildAccountantReport(
        fixture.householdB,
        { ...base, categoryId: fixture.unusedCategoryA.id },
        db!,
        referenceDate,
      ),
    ]);

    assert.equal(all.totals.total, 135);
    assert.equal(all.totals.count, 4);
    assert.equal(all.expenses.some((expense) => expense.invoiceNumber === "A-DELETED"), false);
    assert.deepEqual(byCategory.expenses.map((expense) => expense.id), [filteredExpense.id]);
    assert.equal(byCategory.totals.total, 75);
    assert.deepEqual(byMember.expenses.map((expense) => expense.id), [filteredExpense.id]);
    assert.equal(byMember.memberBreakdown[0]?.name, fixture.userB.name);
    assert.equal(crossHousehold.totals.count, 0);
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("dashboard analytics totals and breakdowns are active-only and household-scoped", async () => {
  const fixture = await createFixture();
  try {
    const [analyticsA, analyticsB] = await Promise.all([
      getDashboardAnalytics(fixture.householdA.id, db!, referenceDate, "UTC"),
      getDashboardAnalytics(fixture.householdB.id, db!, referenceDate, "UTC"),
    ]);

    assert.deepEqual(analyticsA.thisMonth, { total: 60, count: 3 });
    assert.deepEqual(analyticsA.thisYear, { total: 100, count: 4 });
    assert.equal(analyticsA.highestCategoryThisMonth?.name, fixture.usedCategoryA.name);
    assert.equal(analyticsA.highestCategoryThisMonth?.total, 60);
    assert.equal(analyticsA.topSpenderThisMonth?.name, fixture.userA.name);
    assert.equal(analyticsA.categoryBreakdownThisYear[0]?.total, 100);
    assert.equal(analyticsA.memberBreakdownThisYear[0]?.total, 100);
    assert.equal(analyticsA.expenseCount.allTime, 5);
    assert.deepEqual(analyticsB.thisMonth, { total: 100, count: 1 });
    assert.equal(analyticsB.categoryBreakdownThisYear[0]?.name, fixture.categoryB.name);
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("expense entered by one member but paid by another attributes spending to the paid-by member", async () => {
  // Jay (userA, OWNER of household A) enters a receipt that belongs to Osama (userB).
  const fixture = await createFixture();
  await db.membership.create({
    data: { userId: fixture.userB.id, householdId: fixture.householdA.id, role: "MEMBER" },
  });
  await db.expense.create({
    data: {
      userId: fixture.userA.id, // entered by Jay
      paidByUserId: fixture.userB.id, // paid by / assigned to Osama
      householdId: fixture.householdA.id,
      categoryId: fixture.usedCategoryA.id,
      invoiceNumber: "JAY-FOR-OSAMA",
      invoiceDate: new Date("2026-06-04T00:00:00.000Z"),
      amount: 84,
      filePath: "uploads/jay-for-osama.pdf",
    },
  });

  try {
    const monthFilters = normalizeReportFilters({ period: "month", pageSize: "50" });
    const report = await getReportData(fixture.householdA.id, monthFilters, db!, referenceDate);

    // Member spending attributes the 84 to Osama; Jay keeps only his own 60 (June fixture).
    const osama = report.members.find((m) => m.userId === fixture.userB.id);
    const jay = report.members.find((m) => m.userId === fixture.userA.id);
    assert.equal(osama?.total?.toString(), "84");
    assert.equal(jay?.total?.toString(), "60");

    // The register records Jay as entered-by and Osama as paid-by on the same row.
    const row = report.expenses.find((e) => e.invoiceNumber === "JAY-FOR-OSAMA");
    assert.equal(row?.user.name, fixture.userA.name);
    assert.equal(row?.paidByUser.name, fixture.userB.name);

    // Filtering by Osama returns it; filtering by Jay excludes it.
    const byOsama = await getReportData(
      fixture.householdA.id,
      normalizeReportFilters({ period: "month", memberUserId: fixture.userB.id, pageSize: "50" }),
      db!,
      referenceDate,
    );
    assert.equal(byOsama.summary.total?.toString(), "84");
    assert.equal(byOsama.expenses.some((e) => e.invoiceNumber === "JAY-FOR-OSAMA"), true);

    const byJay = await getReportData(
      fixture.householdA.id,
      normalizeReportFilters({ period: "month", memberUserId: fixture.userA.id, pageSize: "50" }),
      db!,
      referenceDate,
    );
    assert.equal(byJay.summary.total?.toString(), "60");
    assert.equal(byJay.expenses.some((e) => e.invoiceNumber === "JAY-FOR-OSAMA"), false);

    // Dashboard analytics attribute the year total to Osama, not Jay.
    const analytics = await getDashboardAnalytics(fixture.householdA.id, db!, referenceDate, "UTC");
    assert.equal(
      analytics.memberBreakdownThisYear.find((m) => m.userId === fixture.userB.id)?.total,
      84,
    );

    // Cross-household isolation: household B still sees only its own expense.
    const reportB = await getReportData(fixture.householdB.id, monthFilters, db!, referenceDate);
    assert.equal(reportB.expenses.some((e) => e.invoiceNumber === "JAY-FOR-OSAMA"), false);
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("resolvePaidByUserId enforces assign-on-behalf permission and active membership", async () => {
  const fixture = await createFixture();
  await db.membership.create({
    data: { userId: fixture.userB.id, householdId: fixture.householdA.id, role: "MEMBER" },
  });
  const ownerAuth = fixture.authA; // OWNER (Jay) in household A
  const memberAuthB: AuthContext = {
    ...fixture.authA,
    user: {
      id: fixture.userB.id,
      name: fixture.userB.name,
      email: fixture.userB.email,
      role: fixture.userB.role,
    },
    householdRole: "MEMBER",
  };
  const strangerId = crypto.randomUUID();

  try {
    // Owner: defaults to self, may assign to an active member, rejects non-members.
    assert.equal(await resolvePaidByUserId(ownerAuth, undefined, db!), fixture.userA.id);
    assert.equal(await resolvePaidByUserId(ownerAuth, fixture.userB.id, db!), fixture.userB.id);
    assert.equal(await resolvePaidByUserId(ownerAuth, strangerId, db!), null);

    // Member: may keep self, may not assign to another member.
    assert.equal(await resolvePaidByUserId(memberAuthB, fixture.userB.id, db!), fixture.userB.id);
    assert.equal(await resolvePaidByUserId(memberAuthB, fixture.userA.id, db!), null);

    // Removed members can no longer be newly assigned.
    await db.membership.updateMany({
      where: { userId: fixture.userB.id, householdId: fixture.householdA.id },
      data: { removedAt: new Date() },
    });
    assert.equal(await resolvePaidByUserId(ownerAuth, fixture.userB.id, db!), null);
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("resolvePaidByUserIdForEdit restricts post-creation reassignment to owner/admin", async () => {
  const fixture = await createFixture();
  await db.membership.create({
    data: { userId: fixture.userB.id, householdId: fixture.householdA.id, role: "MEMBER" },
  });
  const ownerAuth = fixture.authA; // OWNER (Jay) in household A
  const memberAuthB: AuthContext = {
    ...fixture.authA,
    user: {
      id: fixture.userB.id,
      name: fixture.userB.name,
      email: fixture.userB.email,
      role: fixture.userB.role,
    },
    householdRole: "MEMBER",
  };
  const viewerAuthB: AuthContext = { ...memberAuthB, householdRole: "VIEWER" };
  const strangerId = crypto.randomUUID();

  try {
    // Owner: unchanged when omitted or equal; may reassign to an active member.
    assert.deepEqual(
      await resolvePaidByUserIdForEdit(ownerAuth, undefined, fixture.userA.id, db!),
      { ok: true, paidByUserId: fixture.userA.id },
    );
    assert.deepEqual(
      await resolvePaidByUserIdForEdit(ownerAuth, fixture.userA.id, fixture.userA.id, db!),
      { ok: true, paidByUserId: fixture.userA.id },
    );
    assert.deepEqual(
      await resolvePaidByUserIdForEdit(ownerAuth, fixture.userB.id, fixture.userA.id, db!),
      { ok: true, paidByUserId: fixture.userB.id },
    );

    // Owner reassigning to a non-member is a 400 (bad target), not a 403.
    const ownerToStranger = await resolvePaidByUserIdForEdit(
      ownerAuth,
      strangerId,
      fixture.userA.id,
      db!,
    );
    assert.equal(ownerToStranger.ok, false);
    assert.equal(ownerToStranger.ok === false && ownerToStranger.status, 400);

    // Member: no change to its own attribution is allowed (editing other fields).
    assert.deepEqual(
      await resolvePaidByUserIdForEdit(memberAuthB, fixture.userB.id, fixture.userB.id, db!),
      { ok: true, paidByUserId: fixture.userB.id },
    );

    // Member cannot reassign an owner-assigned expense to another member — 403.
    const memberToOther = await resolvePaidByUserIdForEdit(
      memberAuthB,
      fixture.userA.id,
      fixture.userB.id,
      db!,
    );
    assert.equal(memberToOther.ok, false);
    assert.equal(memberToOther.ok === false && memberToOther.status, 403);

    // The blocker scenario: an expense the member entered was assigned to userA by an
    // owner; the member tries to claim it back to themselves. Must be rejected (403),
    // never silently reclaimed — and rejected before any membership lookup.
    const memberReclaimSelf = await resolvePaidByUserIdForEdit(
      memberAuthB,
      fixture.userB.id,
      fixture.userA.id,
      db!,
    );
    assert.equal(memberReclaimSelf.ok, false);
    assert.equal(memberReclaimSelf.ok === false && memberReclaimSelf.status, 403);

    // Viewer attempting any change is also rejected with 403 by the same gate.
    const viewerChange = await resolvePaidByUserIdForEdit(
      viewerAuthB,
      fixture.userB.id,
      fixture.userA.id,
      db!,
    );
    assert.equal(viewerChange.ok, false);
    assert.equal(viewerChange.ok === false && viewerChange.status, 403);
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
