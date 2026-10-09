import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { prisma } from "../lib/db/prisma";
import { toCents } from "../lib/money";
import { assertSafeTestDatabase } from "./helpers/test-database";
import { money } from "./helpers/expense-money";

assertSafeTestDatabase();

const suffix = crypto.randomUUID();
let fixture: Awaited<ReturnType<typeof createFixture>>;

async function createFixture() {
  const user = await prisma.user.create({
    data: { name: "Fields", email: `fields-${suffix}@example.com` },
  });
  const household = await prisma.household.create({ data: { name: `Fields ${suffix}` } });
  await prisma.membership.create({
    data: { userId: user.id, householdId: household.id, role: "OWNER" },
  });
  const category = await prisma.category.create({
    data: { householdId: household.id, name: `Cat ${suffix}` },
  });
  return { user, household, category };
}

function baseExpense(invoiceNumber: string) {
  return {
    userId: fixture.user.id,
    paidByUserId: fixture.user.id,
    householdId: fixture.household.id,
    categoryId: fixture.category.id,
    invoiceNumber,
    invoiceDate: new Date("2026-06-01T00:00:00.000Z"),
    filePath: `uploads/${invoiceNumber}.pdf`,
  };
}

before(async () => {
  fixture = await createFixture();
});

after(async () => {
  await prisma.expense.deleteMany({ where: { householdId: fixture.household.id } });
  await prisma.category.deleteMany({ where: { householdId: fixture.household.id } });
  await prisma.membership.deleteMany({ where: { householdId: fixture.household.id } });
  await prisma.household.delete({ where: { id: fixture.household.id } });
  await prisma.user.delete({ where: { id: fixture.user.id } });
  await prisma.$disconnect();
});

test("the step-4 columns default the way existing rows need them to", async () => {
  // A row written with only the pre-step-4 fields: this is what every existing
  // expense looked like when the migration ran.
  const row = await prisma.expense.create({
    data: { ...baseExpense(`DEF-${suffix}`), ...money(42.5) },
  });

  assert.equal(row.amountCents, 4250);
  assert.equal(row.taxCents, null);
  assert.equal(row.currency.trim(), "CAD");
  assert.equal(row.vendor, null);
  assert.equal(row.paymentMethod, null);
  assert.equal(row.notes, null);
  assert.equal(row.isBusiness, false);
});

test("the migration's backfill reproduces amount_cents from the decimal column", async () => {
  // Insert past Prisma with only the deprecated column set, then run the same
  // expression the migration used. This is the backfill existing rows got.
  const id = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO expenses (id, user_id, paid_by_user_id, household_id, category_id,
                          invoice_number, invoice_date, amount, amount_cents, file_path,
                          created_at, updated_at)
    VALUES (${id}::uuid, ${fixture.user.id}::uuid, ${fixture.user.id}::uuid,
            ${fixture.household.id}::uuid, ${fixture.category.id}::uuid,
            ${`RAW-${suffix}`}, '2026-06-01', 1234.56, 0, 'uploads/raw.pdf', now(), now())
  `;
  await prisma.$executeRaw`
    UPDATE expenses SET amount_cents = ROUND(amount * 100)::INTEGER WHERE id = ${id}::uuid
  `;

  const row = await prisma.expense.findUniqueOrThrow({ where: { id } });
  assert.equal(row.amountCents, 123456);
  assert.equal(row.amountCents, toCents(Number(row.amount)));
});

test("every step-4 field round-trips", async () => {
  const row = await prisma.expense.create({
    data: {
      ...baseExpense(`FULL-${suffix}`),
      ...money(113),
      taxCents: 1300,
      currency: "USD",
      vendor: "Home Hardware",
      paymentMethod: "CREDIT",
      notes: "Replacement part for the rental unit",
      isBusiness: true,
    },
  });

  const read = await prisma.expense.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(read.amountCents, 11300);
  assert.equal(read.taxCents, 1300);
  assert.equal(read.currency.trim(), "USD");
  assert.equal(read.vendor, "Home Hardware");
  assert.equal(read.paymentMethod, "CREDIT");
  assert.equal(read.notes, "Replacement part for the rental unit");
  assert.equal(read.isBusiness, true);
  // The deprecated column stays in step so a rollback can read it.
  assert.equal(read.amount.toString(), "113");
});

test("the database refuses money that contradicts itself", async () => {
  await assert.rejects(
    () =>
      prisma.expense.create({
        data: { ...baseExpense(`NEG-${suffix}`), amount: "-1.00", amountCents: -100 },
      }),
    /amount_cents_nonnegative/,
    "negative total must be rejected",
  );

  await assert.rejects(
    () =>
      prisma.expense.create({
        data: { ...baseExpense(`TAX-${suffix}`), ...money(10), taxCents: 1001 },
      }),
    /tax_cents_within_total/,
    "tax above the inclusive total must be rejected",
  );

  await assert.rejects(
    () =>
      prisma.expense.create({
        data: { ...baseExpense(`TAXNEG-${suffix}`), ...money(10), taxCents: -1 },
      }),
    /tax_cents_nonnegative/,
    "negative tax must be rejected",
  );
});

test("vehicle columns default to null and round-trip", async () => {
  const plain = await prisma.expense.create({
    data: { ...baseExpense(`VEH0-${suffix}`), ...money(10) },
  });
  assert.equal(plain.vehicleLabel, null);
  assert.equal(plain.odometerKm, null);

  const created = await prisma.expense.create({
    data: {
      ...baseExpense(`VEH1-${suffix}`),
      ...money(10),
      vehicleLabel: "Test Civic",
      odometerKm: 123456,
    },
  });
  const read = await prisma.expense.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(read.vehicleLabel, "Test Civic");
  assert.equal(read.odometerKm, 123456);

  const labelOnly = await prisma.expense.create({
    data: { ...baseExpense(`VEH2-${suffix}`), ...money(10), vehicleLabel: "Test Truck" },
  });
  assert.equal(labelOnly.odometerKm, null);
});

test("the database refuses a negative odometer or one without a vehicle", async () => {
  await assert.rejects(
    () =>
      prisma.expense.create({
        data: {
          ...baseExpense(`ODONEG-${suffix}`),
          ...money(10),
          vehicleLabel: "Test Civic",
          odometerKm: -1,
        },
      }),
    /odometer_km_nonnegative/,
    "negative odometer must be rejected",
  );

  await assert.rejects(
    () =>
      prisma.expense.create({
        data: { ...baseExpense(`ODONOV-${suffix}`), ...money(10), odometerKm: 500 },
      }),
    /odometer_needs_vehicle/,
    "odometer without a vehicle must be rejected",
  );
});
