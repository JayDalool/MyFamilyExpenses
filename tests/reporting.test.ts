import assert from "node:assert/strict";
import test from "node:test";
import {
  getReportDateRange,
  INVALID_CUSTOM_DATE_RANGE_MESSAGE,
  normalizeReportFilters,
  parseReportFilters,
  parseStrictDateOnly,
} from "../lib/reporting";

test("report filters normalize invalid pagination for valid periods", () => {
  const filters = normalizeReportFilters({
    period: "month",
    page: "-10",
    pageSize: "500",
  });

  assert.equal(filters.period, "month");
  assert.equal(filters.page, 1);
  assert.equal(filters.pageSize, 50);
});

test("strict date parsing rejects impossible dates and accepts leap days", () => {
  for (const value of ["2026-02-31", "2026-00-01", "2026-13-01", "2026-04-31", "2025-02-29"]) {
    assert.equal(parseStrictDateOnly(value), null, value);
  }

  assert.equal(parseStrictDateOnly("2024-02-29")?.toISOString().slice(0, 10), "2024-02-29");
});

test("invalid custom report filters are explicit and never fall back", () => {
  for (const searchParams of [
    { period: "custom", fromDate: "2026-02-31", toDate: "2026-03-02" },
    { period: "custom", fromDate: "2026-06-02", toDate: "2026-06-01" },
    { period: "custom", fromDate: "2026-06-01" },
    { period: "custom", toDate: "2026-06-01" },
  ]) {
    const result = parseReportFilters(searchParams);
    assert.equal(result.ok, false);
    assert.equal(result.filters.period, "custom");
    if (!result.ok) assert.equal(result.error, INVALID_CUSTOM_DATE_RANGE_MESSAGE);
    assert.throws(() => normalizeReportFilters(searchParams), {
      message: INVALID_CUSTOM_DATE_RANGE_MESSAGE,
    });
  }
});

test("valid leap-day custom ranges remain custom", () => {
  const result = parseReportFilters({
    period: "custom",
    fromDate: "2024-02-29",
    toDate: "2024-02-29",
  });

  assert.equal(result.ok, true);
  assert.equal(result.filters.period, "custom");
  assert.deepEqual(
    Object.values(getReportDateRange(result.filters)).map((date) => date.toISOString().slice(0, 10)),
    ["2024-02-29", "2024-02-29"],
  );
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

test("range calculation refuses invalid direct custom filters", () => {
  assert.throws(
    () =>
      getReportDateRange({
        period: "custom",
        fromDate: "2026-02-31",
        toDate: "2026-03-31",
      }),
    { message: INVALID_CUSTOM_DATE_RANGE_MESSAGE },
  );
});
