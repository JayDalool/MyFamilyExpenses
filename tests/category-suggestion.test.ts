import assert from "node:assert/strict";
import { test } from "node:test";
import type { HouseholdRole } from "@prisma/client";
import type { AuthContext } from "../lib/auth/session";
import {
  handleCategorySuggestionRequest,
  pickCategorySuggestion,
  type VendorCategoryRow,
} from "../lib/category-suggestion";

const d = (day: number) => new Date(Date.UTC(2026, 5, day));
const row = (vendor: string, categoryId: string, count: number, day: number): VendorCategoryRow => ({
  vendor,
  categoryId,
  count,
  lastSavedAt: d(day),
});

test("most frequent category wins", () => {
  const result = pickCategorySuggestion([row("Costco", "food", 2, 1), row("Costco", "home", 1, 9)], "Costco");
  assert.deepEqual(result, { categoryId: "food", count: 2, total: 3 });
});

test("a tie goes to the most recently saved", () => {
  const result = pickCategorySuggestion([row("Costco", "food", 1, 1), row("Costco", "home", 1, 9)], "Costco");
  assert.equal(result?.categoryId, "home");
});

test("store numbers and suffixes still match", () => {
  const result = pickCategorySuggestion([row("Costco", "food", 1, 1)], "COSTCO WHOLESALE #552");
  assert.equal(result?.categoryId, "food");
});

test("short names match when equal after normalizing", () => {
  assert.equal(pickCategorySuggestion([row("A&W", "food", 1, 1)], "a & w")?.categoryId, "food");
});

test("a different vendor does not match", () => {
  assert.equal(pickCategorySuggestion([row("Costco", "food", 1, 1)], "Esso"), null);
});

test("an empty key gives nothing", () => {
  assert.equal(pickCategorySuggestion([row("Costco", "food", 1, 1)], "  "), null);
});

test("case variants add up", () => {
  const result = pickCategorySuggestion(
    [row("costco", "food", 1, 1), row("COSTCO", "food", 1, 2), row("Costco", "home", 1, 3)],
    "Costco",
  );
  assert.deepEqual(result, { categoryId: "food", count: 2, total: 3 });
});

function authAs(role: HouseholdRole): AuthContext {
  return {
    user: { id: "u1", name: "Made Up", email: "madeup@example.com", role: "USER" },
    householdId: "h1",
    householdName: "Made Up Household",
    householdKind: "FAMILY",
    householdRole: role,
    households: [{ id: "h1", name: "Made Up Household", kind: "FAMILY", role }],
  };
}

// A db that fails the test if the handler reaches the database.
const noDb = {
  expense: {
    groupBy: async () => {
      throw new Error("db must not be called");
    },
  },
} as never;

test("handler: 401 without a session", async () => {
  const res = await handleCategorySuggestionRequest(null, { vendor: "Costco" }, noDb);
  assert.equal(res.status, 401);
});

test("handler: 403 for read-only roles", async () => {
  for (const role of ["ACCOUNTANT", "VIEWER"] as const) {
    const res = await handleCategorySuggestionRequest(authAs(role), { vendor: "Costco" }, noDb);
    assert.equal(res.status, 403, role);
  }
});

test("handler: 400 for a missing, empty, blank or too long vendor", async () => {
  const bad: unknown[] = [null, {}, { vendor: "" }, { vendor: "   " }, { vendor: 5 }, { vendor: "x".repeat(121) }];
  for (const body of bad) {
    const res = await handleCategorySuggestionRequest(authAs("OWNER"), body, noDb);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test("handler: 200 with a data.suggestion envelope", async () => {
  const db = {
    expense: {
      groupBy: async () => [
        { vendor: "Costco", categoryId: "food", _count: { _all: 2 }, _max: { updatedAt: d(1) } },
      ],
    },
  } as never;
  const res = await handleCategorySuggestionRequest(authAs("MEMBER"), { vendor: "  costco " }, db);
  assert.deepEqual(res, {
    status: 200,
    body: { data: { suggestion: { categoryId: "food", count: 2, total: 2 } } },
  });
});
