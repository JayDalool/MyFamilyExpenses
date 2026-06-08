import assert from "node:assert/strict";
import test from "node:test";
import { getReportDateRange, normalizeReportFilters } from "../lib/reporting";

test("report filters normalize invalid pagination and incomplete custom ranges", () => {
  const filters = normalizeReportFilters({
    period: "custom",
    fromDate: "2026-06-01",
    page: "-10",
    pageSize: "500",
  });

  assert.equal(filters.period, "month");
  assert.equal(filters.page, 1);
  assert.equal(filters.pageSize, 50);
});

test("report periods use bounded calendar dates in the configured timezone", () => {
  const reference = new Date("2026-06-07T12:00:00.000Z");
  const today = getReportDateRange({ period: "today" }, reference, "UTC");
  const week = getReportDateRange({ period: "week" }, reference, "UTC");
  const month = getReportDateRange({ period: "month" }, reference, "UTC");
  const year = getReportDateRange({ period: "year" }, reference, "UTC");

  assert.deepEqual(
    [today.from, today.to].map((date) => date.toISOString().slice(0, 10)),
    ["2026-06-07", "2026-06-07"],
  );
  assert.deepEqual(
    [week.from, week.to].map((date) => date.toISOString().slice(0, 10)),
    ["2026-06-01", "2026-06-07"],
  );
  assert.deepEqual(
    [month.from, month.to].map((date) => date.toISOString().slice(0, 10)),
    ["2026-06-01", "2026-06-30"],
  );
  assert.deepEqual(
    [year.from, year.to].map((date) => date.toISOString().slice(0, 10)),
    ["2026-01-01", "2026-12-31"],
  );
});
