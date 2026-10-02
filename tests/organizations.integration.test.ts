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
import { changeHouseholdMemberRole } from "../lib/household-members";
import { createHouseholdInvite } from "../lib/household-invites";
import { MAX_OWNED_COMPANIES, countOwnedCompanies, hasReachedCompanyLimit } from "../lib/households";
import { assertSafeTestDatabase } from "./helpers/test-database";
import { money } from "./helpers/expense-money";

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
    legacyViewer: await mk("LegacyViewer"),
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
    // VIEWER is no longer assignable in a company; this row stands in for one
    // written before that rule, or straight to the database.
    ["legacyViewer", "VIEWER"],
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
        ...money(10),
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
    companyViewer: makeAuth(users.legacyViewer, company, "COMPANY", "VIEWER"),
    familyMemberA: makeAuth(users.empA, family, "FAMILY", "MEMBER"),
    familyOwnerA: makeAuth(users.empA, family, "FAMILY", "OWNER"),
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
  await prisma.household.deleteMany({ where: { name: { startsWith: `Extra ${suffix}` } } });
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

test("a leftover company VIEWER is scoped to their own expenses", async () => {
  // The role is not assignable in a company any more, but a row can still exist.
  // It must not read a colleague's receipt.
  const list = await listExpensesForUser(fixture.companyViewer);
  assert.deepEqual(list, []);
  assert.equal(await getExpenseForUser(fixture.companyViewer, fixture.expenses.companyA.id), null);
  assert.equal(await getExpenseForUser(fixture.companyViewer, fixture.expenses.companyB.id), null);
});

test("VIEWER cannot be assigned in a company, but can in a family", async () => {
  const membership = await prisma.membership.findFirstOrThrow({
    where: { userId: fixture.users.empB.id, householdId: fixture.company.id },
  });
  await assert.rejects(
    () => changeHouseholdMemberRole(fixture.owner, membership.id, "VIEWER"),
    /not available in a company workspace/,
  );
  const unchanged = await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } });
  assert.equal(unchanged.role, "MEMBER");

  const familyMembership = await prisma.membership.findFirstOrThrow({
    where: { userId: fixture.users.empB.id, householdId: fixture.family.id },
  });
  const changed = await changeHouseholdMemberRole(fixture.familyOwnerA, familyMembership.id, "VIEWER");
  assert.equal(changed?.role, "VIEWER");
  await prisma.membership.update({ where: { id: familyMembership.id }, data: { role: "MEMBER" } });
});

test("a company invite cannot carry the VIEWER role", async () => {
  await assert.rejects(
    () => createHouseholdInvite(fixture.owner, { role: "VIEWER", expiresInDays: 7, maxUses: 1 }),
    (error: Error) => /inviter_not_authorized/.test(error.message) || error.name === "InviteAcceptanceError",
  );
  const invites = await prisma.householdInvite.count({ where: { householdId: fixture.company.id } });
  assert.equal(invites, 0);
});

test("owning companies is capped per user", async () => {
  const ownerId = fixture.users.owner.id;
  assert.equal(await countOwnedCompanies(ownerId), 1);
  assert.equal(await hasReachedCompanyLimit(ownerId), false);

  const extraIds: string[] = [];
  for (let i = await countOwnedCompanies(ownerId); i < MAX_OWNED_COMPANIES; i += 1) {
    const extra = await prisma.household.create({
      data: {
        name: `Extra ${suffix} ${i}`,
        kind: "COMPANY",
        memberships: { create: { userId: ownerId, role: "OWNER" } },
      },
    });
    extraIds.push(extra.id);
  }

  assert.equal(await countOwnedCompanies(ownerId), MAX_OWNED_COMPANIES);
  assert.equal(await hasReachedCompanyLimit(ownerId), true);

  // A family household and a company someone else owns do not count against it.
  assert.equal(await countOwnedCompanies(fixture.users.empA.id), 0);

  await prisma.membership.deleteMany({ where: { householdId: { in: extraIds } } });
  await prisma.household.deleteMany({ where: { id: { in: extraIds } } });
  assert.equal(await hasReachedCompanyLimit(ownerId), false);
});

test("a household row written without a kind falls back to FAMILY", async () => {
  // Exercises the column default the migration installed, which is what existing
  // rows relied on — not just the Prisma-side default.
  const id = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO households (id, name, created_at, updated_at)
    VALUES (${id}::uuid, ${`Extra ${suffix} legacy`}, now(), now())
  `;
  const row = await prisma.household.findUniqueOrThrow({ where: { id } });
  assert.equal(row.kind, "FAMILY");
  await prisma.household.delete({ where: { id } });
});
