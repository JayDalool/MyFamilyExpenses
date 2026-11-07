import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { HouseholdKind, HouseholdRole } from "@prisma/client";
import { prisma } from "../lib/db/prisma";
import type { AuthContext } from "../lib/auth/session";
import { handleCategorySuggestionRequest, suggestCategoryForVendor } from "../lib/category-suggestion";
import { assertSafeTestDatabase } from "./helpers/test-database";
import { money } from "./helpers/expense-money";

assertSafeTestDatabase();

const suffix = crypto.randomUUID();
let fixture: Awaited<ReturnType<typeof createFixture>>;
let counter = 0;

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
    parent: await mk("SugParent"),
    owner: await mk("SugOwner"),
    empA: await mk("SugEmpA"),
    empB: await mk("SugEmpB"),
  };
  const family = await prisma.household.create({ data: { name: `SugFamily ${suffix}` } });
  const other = await prisma.household.create({ data: { name: `SugOther ${suffix}` } });
  const company = await prisma.household.create({ data: { name: `SugCompany ${suffix}`, kind: "COMPANY" } });
  const memberships: Array<[keyof typeof users, string, HouseholdRole]> = [
    ["parent", family.id, "OWNER"],
    // Expense (userId, householdId) must reference a membership row.
    ["parent", other.id, "OWNER"],
    ["owner", company.id, "OWNER"],
    ["empA", company.id, "MEMBER"],
    ["empB", company.id, "MEMBER"],
  ];
  for (const [key, householdId, role] of memberships) {
    await prisma.membership.create({ data: { userId: users[key].id, householdId, role } });
  }
  const cat = (householdId: string, name: string, status: "ACTIVE" | "DISABLED" = "ACTIVE") =>
    prisma.category.create({ data: { householdId, name: `${name} ${suffix}`, status } });
  const cats = {
    food: await cat(family.id, "Food"),
    home: await cat(family.id, "Home"),
    old: await cat(family.id, "Old", "DISABLED"),
    otherFood: await cat(other.id, "OtherFood"),
    work: await cat(company.id, "Work"),
  };
  return {
    users,
    family,
    other,
    company,
    cats,
    parent: makeAuth(users.parent, family, "FAMILY", "OWNER"),
    owner: makeAuth(users.owner, company, "COMPANY", "OWNER"),
    empA: makeAuth(users.empA, company, "COMPANY", "MEMBER"),
    empB: makeAuth(users.empB, company, "COMPANY", "MEMBER"),
  };
}

async function addExpense(opts: {
  householdId: string;
  categoryId: string;
  userId: string;
  paidByUserId?: string;
  vendor: string;
  deleted?: boolean;
}) {
  counter += 1;
  return prisma.expense.create({
    data: {
      userId: opts.userId,
      paidByUserId: opts.paidByUserId ?? opts.userId,
      householdId: opts.householdId,
      categoryId: opts.categoryId,
      vendor: opts.vendor,
      invoiceNumber: `SUG-${counter}-${suffix}`,
      invoiceDate: new Date("2026-06-01T00:00:00.000Z"),
      ...money(10),
      filePath: `uploads/sug-${counter}-${suffix}.pdf`,
      deletedAt: opts.deleted ? new Date() : null,
    },
  });
}

before(async () => {
  fixture = await createFixture();
  const { family, cats, users, other, company } = fixture;
  const fam = (categoryId: string, vendor: string, deleted = false) =>
    addExpense({ householdId: family.id, categoryId, userId: users.parent.id, vendor, deleted });
  await fam(cats.food.id, "Zzfoodmart");
  await fam(cats.food.id, "ZZFOODMART #12");
  await fam(cats.home.id, "Zzfoodmart");
  await fam(cats.home.id, "Zzfoodmart", true);
  await fam(cats.home.id, "Zzfoodmart", true);
  await fam(cats.old.id, "Zzoldshop");
  await fam(cats.old.id, "Zzmixshop");
  await fam(cats.food.id, "Zzmixshop");
  await addExpense({
    householdId: other.id,
    categoryId: cats.otherFood.id,
    userId: users.parent.id,
    vendor: "Zzothershop",
  });
  await addExpense({
    householdId: company.id,
    categoryId: cats.work.id,
    userId: users.empB.id,
    vendor: "Zzcolleague",
  });
  await addExpense({
    householdId: company.id,
    categoryId: cats.work.id,
    userId: users.empB.id,
    paidByUserId: users.empA.id,
    vendor: "Zzpaidshop",
  });
});

after(async () => {
  const ids = [fixture.family.id, fixture.other.id, fixture.company.id];
  await prisma.expense.deleteMany({ where: { householdId: { in: ids } } });
  await prisma.category.deleteMany({ where: { householdId: { in: ids } } });
  await prisma.membership.deleteMany({ where: { householdId: { in: ids } } });
  await prisma.household.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(fixture.users).map((u) => u.id) } } });
  await prisma.$disconnect();
});

test("family: most frequent live category wins and deleted rows are ignored", async () => {
  const result = await suggestCategoryForVendor(fixture.parent, "Zzfoodmart");
  assert.deepEqual(result, { categoryId: fixture.cats.food.id, count: 2, total: 3 });
});

test("disabled categories are never suggested", async () => {
  assert.equal(await suggestCategoryForVendor(fixture.parent, "Zzoldshop"), null);
  const mixed = await suggestCategoryForVendor(fixture.parent, "Zzmixshop");
  assert.deepEqual(mixed, { categoryId: fixture.cats.food.id, count: 1, total: 1 });
});

test("another household's vendor is never returned", async () => {
  assert.equal(await suggestCategoryForVendor(fixture.parent, "Zzothershop"), null);
});

test("company employee learns only from their own expenses", async () => {
  assert.equal(await suggestCategoryForVendor(fixture.empA, "Zzcolleague"), null);
  assert.equal((await suggestCategoryForVendor(fixture.owner, "Zzcolleague"))?.categoryId, fixture.cats.work.id);
  assert.equal((await suggestCategoryForVendor(fixture.empB, "Zzcolleague"))?.categoryId, fixture.cats.work.id);
});

test("an expense the employee paid for counts", async () => {
  assert.equal((await suggestCategoryForVendor(fixture.empA, "Zzpaidshop"))?.categoryId, fixture.cats.work.id);
});

test("unknown vendor gives nothing", async () => {
  assert.equal(await suggestCategoryForVendor(fixture.parent, "Zzneverseen"), null);
});

test("handler: 200 returns the data.suggestion envelope from the database", async () => {
  const res = await handleCategorySuggestionRequest(fixture.parent, { vendor: " Zzfoodmart " });
  assert.deepEqual(res, {
    status: 200,
    body: { data: { suggestion: { categoryId: fixture.cats.food.id, count: 2, total: 3 } } },
  });
});
