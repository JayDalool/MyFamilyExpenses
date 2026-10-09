import assert from "node:assert/strict";
import test from "node:test";
import { finalExpenseSchema, friendlyExpenseError, parseExpenseForm } from "../lib/validation/expense";

// The create route reads the expense from a multipart form. It parsed only the
// five original keys, so vendor, tax, currency, payment method, notes and the
// business flag were silently dropped on every new expense while the edit path
// worked. 380 tests were green because every test built the row through Prisma
// directly instead of through this mapping. These tests call the same
// parseExpenseForm the route calls, so there is no copy here to drift.
function formDataFromWizard(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append("categoryId", "6f3f8f1a-0000-4000-8000-000000000001");
  fd.append("invoiceNumber", "INV-1");
  fd.append("invoiceDate", "2026-06-01");
  fd.append("amount", "113.00");
  fd.append("paidByUserId", "6f3f8f1a-0000-4000-8000-000000000002");
  fd.append("tax", "13.00");
  fd.append("vendor", "Home Hardware");
  fd.append("paymentMethod", "CREDIT");
  fd.append("notes", "Replacement part");
  fd.append("isBusiness", "true");
  fd.append("vehicleLabel", "Test Civic");
  fd.append("odometerKm", "123456");
  for (const [key, value] of Object.entries(overrides)) {
    fd.set(key, value);
  }
  return fd;
}

test("the create route carries every field the wizard sends", () => {
  const parsed = parseExpenseForm(formDataFromWizard());
  assert.equal(parsed.success, true);
  if (!parsed.success) return;

  assert.equal(parsed.data.amount, 113);
  assert.equal(parsed.data.tax, 13);
  assert.equal(parsed.data.vendor, "Home Hardware");
  assert.equal(parsed.data.paymentMethod, "CREDIT");
  assert.equal(parsed.data.notes, "Replacement part");
  assert.equal(parsed.data.isBusiness, true);
  assert.equal(parsed.data.vehicleLabel, "Test Civic");
  assert.equal(parsed.data.odometerKm, 123456);
});

test("an unticked business box means false, not the string \"null\"", () => {
  // An unchecked checkbox is absent from the FormData entirely, so
  // formData.get returns null. String(null) would be "null" and fail the parse.
  const fd = formDataFromWizard();
  fd.delete("isBusiness");

  const parsed = parseExpenseForm(fd);
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.isBusiness, false);
});

test("fields the wizard leaves blank arrive as undefined, not empty strings", () => {
  const parsed = parseExpenseForm(
    formDataFromWizard({ tax: "", vendor: "", paymentMethod: "", notes: "", currency: "" }),
  );
  assert.equal(parsed.success, true);
  if (!parsed.success) return;

  assert.equal(parsed.data.tax, undefined);
  assert.equal(parsed.data.vendor, undefined);
  assert.equal(parsed.data.paymentMethod, undefined);
  assert.equal(parsed.data.notes, undefined);
  assert.equal(parsed.data.currency, undefined);
});

test("blank vehicle fields arrive as undefined", () => {
  const parsed = parseExpenseForm(formDataFromWizard({ vehicleLabel: "", odometerKm: "" }));
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.vehicleLabel, undefined);
  assert.equal(parsed.data.odometerKm, undefined);
});

test("odometer must be whole kilometres from 0 to 2,000,000 and needs a vehicle", () => {
  for (const bad of ["12.5", "-1", "2000001", "abc"]) {
    const parsed = parseExpenseForm(formDataFromWizard({ odometerKm: bad }));
    assert.equal(parsed.success, false, `odometer ${bad} should be refused`);
  }
  for (const good of ["0", "2000000"]) {
    assert.equal(parseExpenseForm(formDataFromWizard({ odometerKm: good })).success, true);
  }

  const noVehicle = parseExpenseForm(formDataFromWizard({ vehicleLabel: "", odometerKm: "500" }));
  assert.equal(noVehicle.success, false);
  if (noVehicle.success) return;
  assert.equal(noVehicle.error.issues[0]?.path[0], "odometerKm");
  assert.match(friendlyExpenseError(noVehicle.error), /odometer/i);

  // A vehicle without an odometer is fine, and an 81-character label is not.
  assert.equal(parseExpenseForm(formDataFromWizard({ odometerKm: "" })).success, true);
  const long = parseExpenseForm(formDataFromWizard({ vehicleLabel: "x".repeat(81) }));
  assert.equal(long.success, false);
  if (long.success) return;
  assert.match(friendlyExpenseError(long.error), /vehicle/i);
});

test("the create route rejects tax above the inclusive total", () => {
  // finalExpenseSchema carries the refinement; the database carries the same
  // rule as a CHECK constraint.
  const input = parseExpenseForm(formDataFromWizard({ amount: "10.00", tax: "11.00" }));
  assert.equal(input.success, true);
  if (!input.success) return;

  const finalized = finalExpenseSchema.safeParse({
    categoryId: input.data.categoryId,
    invoiceNumber: "INV-1",
    invoiceDate: "2026-06-01",
    amount: input.data.amount,
    tax: input.data.tax,
    currency: input.data.currency,
    vendor: input.data.vendor,
    paymentMethod: input.data.paymentMethod,
    notes: input.data.notes,
    isBusiness: input.data.isBusiness,
    vehicleLabel: input.data.vehicleLabel,
    odometerKm: input.data.odometerKm,
  });

  assert.equal(finalized.success, false);
  if (finalized.success) return;
  assert.equal(finalized.error.issues[0]?.path[0], "tax");
});

test("a bad payment method or currency is refused rather than stored", () => {
  assert.equal(parseExpenseForm(formDataFromWizard({ paymentMethod: "BITCOIN" })).success, false);
  assert.equal(parseExpenseForm(formDataFromWizard({ currency: "DOLLARS" })).success, false);
  // Lower case is coerced, not rejected.
  const ok = parseExpenseForm(formDataFromWizard({ currency: "usd" }));
  assert.equal(ok.success, true);
  if (!ok.success) return;
  assert.equal(ok.data.currency, "USD");
});
