import assert from "node:assert/strict";
import { test } from "node:test";
import { pickCategorySuggestion, type VendorCategoryRow } from "../lib/category-suggestion";

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
