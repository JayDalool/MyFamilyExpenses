import assert from "node:assert/strict";
import test from "node:test";
import { shouldUseSecureCookies } from "../lib/auth/cookies";

const env = process.env as Record<string, string | undefined>;

function snapshot() {
  return { COOKIE_SECURE: env.COOKIE_SECURE, NODE_ENV: env.NODE_ENV };
}

function restore(prev: ReturnType<typeof snapshot>) {
  if (prev.COOKIE_SECURE === undefined) delete env.COOKIE_SECURE;
  else env.COOKIE_SECURE = prev.COOKIE_SECURE;
  if (prev.NODE_ENV === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = prev.NODE_ENV;
}

test("COOKIE_SECURE=true forces secure cookies regardless of NODE_ENV", () => {
  const prev = snapshot();
  try {
    env.COOKIE_SECURE = "true";
    env.NODE_ENV = "development";
    assert.equal(shouldUseSecureCookies(), true);

    env.NODE_ENV = "production";
    assert.equal(shouldUseSecureCookies(), true);

    delete env.NODE_ENV;
    assert.equal(shouldUseSecureCookies(), true);
  } finally {
    restore(prev);
  }
});

test("COOKIE_SECURE=false disables secure cookies regardless of NODE_ENV", () => {
  const prev = snapshot();
  try {
    env.COOKIE_SECURE = "false";
    env.NODE_ENV = "production";
    assert.equal(shouldUseSecureCookies(), false);

    env.NODE_ENV = "development";
    assert.equal(shouldUseSecureCookies(), false);
  } finally {
    restore(prev);
  }
});

test("fallback uses NODE_ENV=production when COOKIE_SECURE is unset", () => {
  const prev = snapshot();
  try {
    delete env.COOKIE_SECURE;

    env.NODE_ENV = "production";
    assert.equal(shouldUseSecureCookies(), true);

    env.NODE_ENV = "development";
    assert.equal(shouldUseSecureCookies(), false);

    env.NODE_ENV = "test";
    assert.equal(shouldUseSecureCookies(), false);

    delete env.NODE_ENV;
    assert.equal(shouldUseSecureCookies(), false);
  } finally {
    restore(prev);
  }
});

test("COOKIE_SECURE only honours the exact string 'true' or 'false'", () => {
  const prev = snapshot();
  try {
    env.COOKIE_SECURE = "1"; // not the exact string
    env.NODE_ENV = "development";
    assert.equal(shouldUseSecureCookies(), false);

    env.COOKIE_SECURE = "yes";
    env.NODE_ENV = "production";
    assert.equal(shouldUseSecureCookies(), true); // falls back to NODE_ENV
  } finally {
    restore(prev);
  }
});
