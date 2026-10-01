import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_AMOUNT_CENTS,
  centsToDecimalString,
  formatCents,
  fromCents,
  subtotalCents,
  toCents,
} from "../lib/money";

test("toCents scales exactly for the values a receipt actually carries", () => {
  assert.equal(toCents(0), 0);
  assert.equal(toCents(1), 100);
  assert.equal(toCents(123.45), 12345);
  assert.equal(toCents(0.01), 1);
  assert.equal(toCents(19.99), 1999);
  // The classic float traps: 1.005 * 100 is 100.49999999999999 and
  // 8.165 * 100 is 816.4999999999999 in IEEE 754.
  assert.equal(toCents(1.005), 101);
  assert.equal(toCents(8.165), 817);
  assert.equal(toCents(0.07 * 3), 21);
});

test("toCents rounds half away from zero, symmetrically", () => {
  assert.equal(toCents(0.005), 1);
  assert.equal(toCents(-0.005), -1);
  assert.equal(toCents(2.675), 268);
  assert.equal(toCents(-2.675), -268);
});

test("toCents refuses values it cannot represent", () => {
  assert.throws(() => toCents(Number.NaN), RangeError);
  assert.throws(() => toCents(Number.POSITIVE_INFINITY), RangeError);
  assert.throws(() => toCents(Number.MAX_SAFE_INTEGER), RangeError);
});

test("fromCents round-trips every cent value through toCents", () => {
  for (const cents of [0, 1, 99, 100, 101, 12345, 999999, 100000001]) {
    assert.equal(toCents(fromCents(cents)), cents);
  }
});

test("centsToDecimalString writes the deprecated Decimal column exactly", () => {
  assert.equal(centsToDecimalString(0), "0.00");
  assert.equal(centsToDecimalString(5), "0.05");
  assert.equal(centsToDecimalString(50), "0.50");
  assert.equal(centsToDecimalString(100), "1.00");
  assert.equal(centsToDecimalString(12345), "123.45");
  assert.equal(centsToDecimalString(-12345), "-123.45");
  // Never scientific notation, whatever the magnitude.
  assert.equal(centsToDecimalString(MAX_AMOUNT_CENTS), "21474836.47");
});

test("formatCents formats cents, not dollars", () => {
  // The bug this guards: passing cents to a dollar formatter renders 100x.
  assert.match(formatCents(12345), /123\.45/);
  assert.doesNotMatch(formatCents(12345), /12,345/);
  assert.match(formatCents(0), /0\.00/);
});

test("subtotalCents subtracts tax from the inclusive total", () => {
  // The total includes tax, so the pre-tax figure is a subtraction.
  assert.equal(subtotalCents(11300, 1300), 10000);
  assert.equal(subtotalCents(11300, null), null);
  assert.equal(subtotalCents(1300, 1300), 0);
});
