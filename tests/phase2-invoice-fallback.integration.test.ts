import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, test } from "node:test";
import { PrismaClient, type Prisma } from "@prisma/client";
import {
  formatInternalInvoiceNumber,
  isInternalInvoiceNumber,
  nextInternalInvoiceNumber,
} from "../lib/expenses";
import { assertSafeTestDatabase } from "./helpers/test-database";

const testDatabaseUrl = assertSafeTestDatabase();
const db = new PrismaClient({ datasourceUrl: testDatabaseUrl });

after(async () => {
  await db.$disconnect();
});

async function makeMember() {
  const user = await db.user.create({
    data: { name: "Phase 2", email: `phase2-${crypto.randomUUID()}@example.com` },
  });
  const household = await db.household.create({
    data: { name: `Phase 2 ${crypto.randomUUID()}` },
  });
  await db.membership.create({
    data: { userId: user.id, householdId: household.id, role: "OWNER" },
  });
  const category = await db.category.create({
    data: { householdId: household.id, name: `Cat ${crypto.randomUUID()}` },
  });
  return { user, household, category };
}

// Mirror the save route: a user/OCR-provided invoice number is used verbatim;
// otherwise a household-scoped internal number is minted inside the transaction.
async function createExpense(
  member: Awaited<ReturnType<typeof makeMember>>,
  providedInvoice?: string,
) {
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const invoiceNumber =
      providedInvoice ?? (await nextInternalInvoiceNumber(tx, member.household.id));
    return tx.expense.create({
      data: {
        userId: member.user.id,
        paidByUserId: member.user.id,
        householdId: member.household.id,
        categoryId: member.category.id,
        invoiceNumber,
        invoiceDate: new Date("2026-06-19T00:00:00.000Z"),
        amount: "144.48",
        filePath: `uploads/${crypto.randomUUID()}.png`,
      },
    });
  });
}

// ── Pure formatting helpers ──────────────────────────────────────────────────

test("formats and recognizes internal invoice numbers", () => {
  assert.equal(formatInternalInvoiceNumber(1), "AUTO-000001");
  assert.equal(formatInternalInvoiceNumber(42), "AUTO-000042");
  assert.equal(isInternalInvoiceNumber("AUTO-000001"), true);
  assert.equal(isInternalInvoiceNumber("INV-2026-001"), false);
  assert.equal(isInternalInvoiceNumber("TK100234"), false);
});

// ── Sequential assignment ────────────────────────────────────────────────────

test("blank invoice numbers get AUTO-000001 then AUTO-000002", async () => {
  const member = await makeMember();

  const first = await createExpense(member);
  const second = await createExpense(member);

  assert.equal(first.invoiceNumber, "AUTO-000001");
  assert.equal(second.invoiceNumber, "AUTO-000002");
});

test("a detected/user-entered invoice number is preserved, not overwritten", async () => {
  const member = await makeMember();

  const ticket = await createExpense(member, "TK100234");
  assert.equal(ticket.invoiceNumber, "TK100234");

  // The generated sequence resumes at 000001 (the real number is not counted).
  const generated = await createExpense(member);
  assert.equal(generated.invoiceNumber, "AUTO-000001");
});

test("the internal sequence is scoped per household", async () => {
  const a = await makeMember();
  const b = await makeMember();

  const a1 = await createExpense(a);
  const a2 = await createExpense(a);
  const b1 = await createExpense(b);

  assert.equal(a1.invoiceNumber, "AUTO-000001");
  assert.equal(a2.invoiceNumber, "AUTO-000002");
  // Household B starts its own sequence, unaffected by household A.
  assert.equal(b1.invoiceNumber, "AUTO-000001");
});

test("near-concurrent blank saves never mint a duplicate number", async () => {
  const member = await makeMember();

  const results = await Promise.all([
    createExpense(member),
    createExpense(member),
    createExpense(member),
  ]);

  const numbers = results.map((e) => e.invoiceNumber);
  assert.equal(new Set(numbers).size, 3, "all three numbers must be distinct");
  assert.deepEqual(
    [...numbers].sort(),
    ["AUTO-000001", "AUTO-000002", "AUTO-000003"],
  );
});
