import assert from "node:assert/strict";
import test from "node:test";
import {
  CSRF_COOKIE_NAME,
  getCsrfTokenFromCookieString,
  isStateChangingMethod,
} from "../lib/auth/csrf";

test("getCsrfTokenFromCookieString reads the csrf cookie", () => {
  const cookie = `theme=light; ${CSRF_COOKIE_NAME}=abc123; session=value`;

  assert.equal(getCsrfTokenFromCookieString(cookie), "abc123");
});

test("getCsrfTokenFromCookieString decodes encoded cookie values", () => {
  const cookie = `${CSRF_COOKIE_NAME}=abc%20123`;

  assert.equal(getCsrfTokenFromCookieString(cookie), "abc 123");
});

test("isStateChangingMethod detects mutating HTTP methods", () => {
  assert.equal(isStateChangingMethod("POST"), true);
  assert.equal(isStateChangingMethod("patch"), true);
  assert.equal(isStateChangingMethod("DELETE"), true);
  assert.equal(isStateChangingMethod("GET"), false);
});
