import assert from "node:assert/strict";
import test from "node:test";
import { getReportDateRange } from "../lib/reporting";

// Manitoba stayed on UTC-05 permanently from 2026-11-01 (IANA tzdata 2026e).
// Node uses its own bundled ICU time zone data, not the host's tzdata, so an
// older Node (tz 2026c or earlier) still puts Winnipeg at UTC-06 in winter and
// makes "today", the month and the year one day behind from 00:00 to 00:59.
// If these fail, upgrade Node (Dockerfile base and CI) — do not change the dates.
const ZONE = "America/Winnipeg";

function winnipeg(instant: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).format(new Date(instant));
}

function isoDates(range: { from: Date; to: Date }) {
  return [range.from, range.to].map((date) => date.toISOString().slice(0, 10));
}

test(`${ZONE} is UTC-05 in winter (Node tz ${process.versions.tz})`, () => {
  assert.equal(winnipeg("2027-01-15T12:00:00Z"), "2027-01-15, 07:00 GMT-05:00");
});

test(`${ZONE} local midnight on 2026-11-02 is 05:00 UTC`, () => {
  assert.equal(winnipeg("2026-11-02T05:00:00Z"), "2026-11-02, 00:00 GMT-05:00");
  assert.equal(winnipeg("2026-11-02T04:59:00Z"), "2026-11-01, 23:59 GMT-05:00");
});

test("report periods roll over at Winnipeg midnight under permanent UTC-05", () => {
  const today = getReportDateRange({ period: "today" }, new Date("2026-11-02T05:30:00Z"), ZONE);
  assert.deepEqual(isoDates(today), ["2026-11-02", "2026-11-02"]);

  // 00:30 on New Year's Day: month and year must already be 2027.
  const newYear = new Date("2027-01-01T05:30:00Z");
  assert.deepEqual(isoDates(getReportDateRange({ period: "month" }, newYear, ZONE)), [
    "2027-01-01",
    "2027-01-31",
  ]);
  assert.deepEqual(isoDates(getReportDateRange({ period: "year" }, newYear, ZONE)), [
    "2027-01-01",
    "2027-12-31",
  ]);
});
