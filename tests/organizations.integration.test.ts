import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { HouseholdKind, HouseholdRole } from "@prisma/client";
import { prisma } from "../lib/db/prisma";
import type { AuthContext } from "../lib/auth/session";
import {
  getExpenseForUser,
  listExpensesForUser,
  softDeleteExpenseForUser,
  updateExpenseForUser,
} from "../lib/expenses";
import { assertSafeTestDatabase } from "./helpers/test-database";

assertSafeTestDatabase();

const suffix = crypto.randomUUID();
let fixture: Awaited<ReturnType<typeof createFixture>>;

function makeAuth(
  user: { id: string; name: string; email: string },
  household: { id: string; name: string },
  kind: HouseholdKind,
  role: HouseholdRole,
): AuthContext {
  return {
    user: { ...user, role: "USER" },
    householdId: household.id,
    householdName: household.name,
    householdKind: kind,
    householdRole: role,
    households: [{ id: household.id, name: household.name, kind, role }],
  };
}

async function createFixture() {
  const mk = (name: string) =>
    prisma.user.create({ data: { name, email: `${name.toLowerCase()}-${suffix}@example.com` } });
  const users = {
    owner: await mk("Owner"),
    empA: await mk("EmpA"),
    empB: await mk("EmpB"),
    accountant: await mk("Accountant"),
  };
  const company = await prisma.household.create({
    data: { name: `Company ${suffix}`, kind: "COMPANY" },
  });
  const family = await prisma.household.create({ data: { name: `Family ${suffix}` } });

  const roles: Array<[keyof typeof users, HouseholdRole]> = [
    ["owner", "OWNER"],
    ["empA", "MEMBER"],
    ["empB", "MEMBER"],
    ["accountant", "ACCOUNTANT"],
  ];
  for (const [key, role] of roles) {
    await prisma.membership.create({ data: { userId: users[key].id, householdId: company.id, role } });
  }
  // The same two people as plain members of a FAMILY household.
  for (const key of ["empA", "empB"] as const) {
    await prisma.membership.create({ data: { userId: users[key].id, householdId: family.id, role: "MEMBER" } });
  }

  const companyCategory = await prisma.category.create({ data: { householdId: company.id, name: `C ${suffix}` } });
  const familyCategory = await prisma.category.create({ data: { householdId: family.id, name: `F ${suffix}` } });

  const mkExpense = (
    householdId: string,
    categoryId: string,
    userId: string,
    invoiceNumber: string,
  ) =>
    prisma.expense.create({
      data: {
        userId,
        paidByUserId: userId,
        householdId,
        categoryId,
        invoiceNumber,
        invoiceDate: new Date("2026-06-01T00:00:00.000Z"),
        amount: 10,
        filePath: `uploads/${invoiceNumber}.pdf`,
      },
    });

  const expenses = {
    companyA: await mkExpense(company.id, companyCategory.id, users.empA.id, `CA-${suffix}`),
    companyB: await mkExpense(company.id, companyCategory.id, users.empB.id, `CB-${suffix}`),
    familyA: await mkExpense(family.id, familyCategory.id, users.empA.id, `FA-${suffix}`),
    familyB: await mkExpense(family.id, familyCategory.id, users.empB.id, `FB-${suffix}`),
  };

  return {
    users,
    company,
    family,
    expenses,
    employeeA: makeAuth(users.empA, company, "COMPANY", "MEMBER"),
    accountant: makeAuth(users.accountant, company, "COMPANY", "ACCOUNTANT"),
    owner: makeAuth(users.owner, company, "COMPANY", "OWNER"),
    familyMemberA: makeAuth(users.empA, family, "FAMILY", "MEMBER"),
  };
}

before(async () => {
  fixture = await createFixture();
});

after(async () => {
  const householdIds = [fixture.company.id, fixture.family.id];
  await prisma.expense.deleteMany({ where: { householdId: { in: householdIds } } });
  await prisma.category.deleteMany({ where: { householdId: { in: householdIds } } });
  await prisma.membership.deleteMany({ where: { householdId: { in: householdIds } } });
  await prisma.household.deleteMany({ where: { id: { in: householdIds } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(fixture.users).map((u) => u.id) } } });
  await prisma.$disconnect();
});

test("company employee lists and opens only their own expenses", async () => {
  const list = await listExpensesForUser(fixture.employeeA);
  assert.deepEqual(list.map((e) => e.id), [fixture.expenses.companyA.id]);

  assert.ok(await getExpenseForUser(fixture.employeeA, fixture.expenses.companyA.id));
  assert.equal(await getExpenseForUser(fixture.employeeA, fixture.expenses.companyB.id), null);
});

test("company accountant and owner see every expense", async () => {
  for (const who of [fixture.accountant, fixture.owner]) {
    const ids = (await listExpensesForUser(who)).map((e) => e.id).sort();
    assert.deepEqual(ids, [fixture.expenses.companyA.id, fixture.expenses.companyB.id].sort());
  }
});

test("accountant cannot edit or delete expenses", async () => {
  const id = fixture.expenses.companyA.id;
  assert.equal(await updateExpenseForUser(fixture.accountant, id, { amount: 99 }), null);
  assert.equal(
    await softDeleteExpenseForUser(fixture.accountant, id, fixture.users.accountant.id),
    null,
  );
  const unchanged = await prisma.expense.findUniqueOrThrow({ where: { id } });
  assert.equal(Number(unchanged.amount), 10);
  assert.equal(unchanged.deletedAt, null);
});

test("the same person sees all expenses as a family member", async () => {
  const ids = (await listExpensesForUser(fixture.familyMemberA)).map((e) => e.id).sort();
  assert.deepEqual(ids, [fixture.expenses.familyA.id, fixture.expenses.familyB.id].sort());
});

test("existing households default to FAMILY", async () => {
  const household = await prisma.household.findUniqueOrThrow({ where: { id: fixture.family.id } });
  assert.equal(household.kind, "FAMILY");
});
