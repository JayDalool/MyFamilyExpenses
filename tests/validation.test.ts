import assert from "node:assert/strict";
import test from "node:test";
import { loginSchema } from "../lib/validation/auth";
import {
  expenseHistoryFiltersSchema,
  expenseInputSchema,
  finalExpenseSchema,
} from "../lib/validation/expense";

test("login schema normalizes email to lowercase", () => {
  const parsed = loginSchema.parse({
    email: "ADMIN@EXAMPLE.COM",
    password: "ChangeMe123!",
  });

  assert.equal(parsed.email, "admin@example.com");
});

test("expense input schema allows blank OCR-backed fields", () => {
  const parsed = expenseInputSchema.parse({
    categoryId: "6dd5ab70-6866-4ae1-a0c0-567c1714d062",
    invoiceNumber: "",
    invoiceDate: "",
    amount: "",
  });

  assert.equal(parsed.invoiceNumber, undefined);
  assert.equal(parsed.invoiceDate, undefined);
  assert.equal(parsed.amount, undefined);
});

test("final expense schema requires invoice data", () => {
  const parsed = finalExpenseSchema.parse({
    categoryId: "6dd5ab70-6866-4ae1-a0c0-567c1714d062",
    invoiceNumber: "INV-1001",
    invoiceDate: "2026-04-22",
    amount: 42.5,
  });

  assert.equal(parsed.invoiceNumber, "INV-1001");
  assert.equal(parsed.invoiceDate, "2026-04-22");
  assert.equal(parsed.amount, 42.5);
});

test("expense history filters schema accepts invoice and date filters", () => {
  const parsed = expenseHistoryFiltersSchema.parse({
    invoiceNumber: "INV-1001",
    categoryId: "6dd5ab70-6866-4ae1-a0c0-567c1714d062",
    fromDate: "2026-04-01",
    toDate: "2026-04-30",
  });

  assert.equal(parsed.invoiceNumber, "INV-1001");
  assert.equal(parsed.categoryId, "6dd5ab70-6866-4ae1-a0c0-567c1714d062");
  assert.equal(parsed.fromDate, "2026-04-01");
  assert.equal(parsed.toDate, "2026-04-30");
});
