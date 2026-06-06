import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { writeAuditLog } from "../lib/audit";
import type { AuthContext } from "../lib/auth/session";
import {
  findAllowedExpenseCategoryForUpdate,
  getActiveExpenseScope,
  getExpenseForUser,
  listExpensesPageForUser,
  softDeleteExpenseForUser,
  updateExpenseForUser,
} from "../lib/expenses";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;
const db = testDatabaseUrl ? new PrismaClient({ datasourceUrl: testDatabaseUrl }) : null;

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture() {
  if (!db) throw new Error("TEST_DATABASE_URL is required.");

  const [userA, userB] = await Promise.all([
    db.user.create({
      data: { name: "Phase One A", email: `phase-a-${crypto.randomUUID()}@example.com` },
    }),
    db.user.create({
      data: { name: "Phase One B", email: `phase-b-${crypto.randomUUID()}@example.com` },
    }),
  ]);
  const [householdA, householdB] = await Promise.all([
    db.household.create({ data: { name: `Phase A ${crypto.randomUUID()}` } }),
    db.household.create({ data: { name: `Phase B ${crypto.randomUUID()}` } }),
  ]);

  await db.membership.createMany({
    data: [
      { userId: userA.id, householdId: householdA.id, role: "OWNER" },
      { userId: userB.id, householdId: householdB.id, role: "OWNER" },
    ],
  });

  const [activeCategoryA, disabledCategoryA, secondDisabledCategoryA, activeCategoryB] =
    await Promise.all([
      db.category.create({
        data: { householdId: householdA.id, name: `Active ${crypto.randomUUID()}` },
      }),
      db.category.create({
        data: {
          householdId: householdA.id,
          name: `Disabled ${crypto.randomUUID()}`,
          status: "DISABLED",
        },
      }),
      db.category.create({
        data: {
          householdId: householdA.id,
          name: `Other disabled ${crypto.randomUUID()}`,
          status: "DISABLED",
        },
      }),
      db.category.create({
        data: { householdId: householdB.id, name: `Active B ${crypto.randomUUID()}` },
      }),
    ]);

  const expensesA = await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      db.expense.create({
        data: {
          userId: userA.id,
          householdId: householdA.id,
          categoryId: index === 0 ? disabledCategoryA.id : activeCategoryA.id,
          invoiceNumber: `A-${String(index).padStart(2, "0")}`,
          invoiceDate: new Date(`2026-05-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`),
          amount: index + 1,
          filePath: `uploads/a-${index}.pdf`,
          ...(index === 1 ? { deletedAt: new Date(), deletedByUserId: userA.id } : {}),
        },
      }),
    ),
  );
  const expenseB = await db.expense.create({
    data: {
      userId: userB.id,
      householdId: householdB.id,
      categoryId: activeCategoryB.id,
      invoiceNumber: "B-00",
      invoiceDate: new Date("2026-05-01T00:00:00.000Z"),
      amount: 50,
      filePath: "uploads/b.pdf",
    },
  });

  const authA: AuthContext = {
    user: { id: userA.id, name: userA.name, email: userA.email, role: userA.role },
    householdId: householdA.id,
    householdRole: "OWNER",
  };
  const authB: AuthContext = {
    user: { id: userB.id, name: userB.name, email: userB.email, role: userB.role },
    householdId: householdB.id,
    householdRole: "OWNER",
  };

  return {
    userA,
    userB,
    householdA,
    householdB,
    activeCategoryA,
    disabledCategoryA,
    secondDisabledCategoryA,
    expensesA,
    expenseB,
    authA,
    authB,
  };
}

async function cleanupFixture(fixture: Fixture) {
  if (!db) return;

  await db.auditLog.deleteMany({
    where: {
      OR: [
        { householdId: { in: [fixture.householdA.id, fixture.householdB.id] } },
        { userId: { in: [fixture.userA.id, fixture.userB.id] } },
      ],
    },
  });
  await db.expense.deleteMany({
    where: { householdId: { in: [fixture.householdA.id, fixture.householdB.id] } },
  });
  await db.category.deleteMany({
    where: { householdId: { in: [fixture.householdA.id, fixture.householdB.id] } },
  });
  await db.membership.deleteMany({
    where: { householdId: { in: [fixture.householdA.id, fixture.householdB.id] } },
  });
  await db.household.deleteMany({
    where: { id: { in: [fixture.householdA.id, fixture.householdB.id] } },
  });
  await db.user.deleteMany({ where: { id: { in: [fixture.userA.id, fixture.userB.id] } } });
}

before(async () => {
  await db?.$connect();
});

after(async () => {
  await db?.$disconnect();
});

integrationTest("expense pagination returns only the requested page", async () => {
  const fixture = await createFixture();
  try {
    const result = await listExpensesPageForUser(
      fixture.authA,
      { page: 2, pageSize: 4 },
      db!,
    );

    assert.equal(result.pagination.total, 11);
    assert.equal(result.pagination.page, 2);
    assert.equal(result.expenses.length, 4);
    assert.deepEqual(
      result.expenses.map((expense) => expense.invoiceNumber),
      ["A-07", "A-06", "A-05", "A-04"],
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("soft-deleted expenses are hidden from active scopes and detail queries", async () => {
  const fixture = await createFixture();
  try {
    const deleted = fixture.expensesA[1]!;
    const detail = await getExpenseForUser(fixture.authA, deleted.id, db!);
    const activeSummary = await db!.expense.aggregate({
      where: getActiveExpenseScope(fixture.householdA.id),
      _count: { _all: true },
      _sum: { amount: true },
    });

    assert.equal(detail, null);
    assert.equal(activeSummary._count._all, 11);
    assert.equal(activeSummary._sum.amount?.toString(), "76");
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("expense update and delete stay inside the authenticated household", async () => {
  const fixture = await createFixture();
  try {
    const target = fixture.expensesA[2]!;
    const crossUpdate = await updateExpenseForUser(
      fixture.authB,
      target.id,
      { invoiceNumber: "CROSS-HOUSEHOLD" },
      db!,
    );
    const crossDelete = await softDeleteExpenseForUser(
      fixture.authB,
      target.id,
      fixture.userB.id,
      db!,
    );
    const unchanged = await db!.expense.findUniqueOrThrow({ where: { id: target.id } });

    assert.equal(crossUpdate, null);
    assert.equal(crossDelete, null);
    assert.equal(unchanged.invoiceNumber, target.invoiceNumber);
    assert.equal(unchanged.deletedAt, null);
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("an expense may retain its disabled category but cannot switch to another", async () => {
  const fixture = await createFixture();
  try {
    const retained = await findAllowedExpenseCategoryForUpdate(
      fixture.authA,
      fixture.disabledCategoryA.id,
      fixture.disabledCategoryA.id,
      db!,
    );
    const switched = await findAllowedExpenseCategoryForUpdate(
      fixture.authA,
      fixture.secondDisabledCategoryA.id,
      fixture.disabledCategoryA.id,
      db!,
    );

    assert.equal(retained?.id, fixture.disabledCategoryA.id);
    assert.equal(switched, null);
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("audit actions persist and audit failures do not throw", async () => {
  const fixture = await createFixture();
  try {
    const actions = [
      "expense.create",
      "expense.update",
      "expense.delete",
      "category.create",
      "category.update",
      "category.delete",
    ];

    for (const action of actions) {
      assert.equal(
        await writeAuditLog(
          {
            userId: fixture.userA.id,
            householdId: fixture.householdA.id,
            action,
            metadata: { entityId: crypto.randomUUID() },
          },
          db!,
        ),
        true,
      );
    }

    const stored = await db!.auditLog.findMany({
      where: { householdId: fixture.householdA.id, action: { in: actions } },
    });
    assert.deepEqual(
      stored.map((entry) => entry.action).sort(),
      [...actions].sort(),
    );

    assert.equal(
      await writeAuditLog(
        {
          userId: crypto.randomUUID(),
          householdId: fixture.householdA.id,
          action: "expense.update",
        },
        db!,
      ),
      false,
    );
  } finally {
    await cleanupFixture(fixture);
  }
});
