import assert from "node:assert/strict";
import test from "node:test";
import { getValidatedSessionSecret } from "../lib/auth/session-secret";

test("returns development fallback when SESSION_SECRET is unset outside production", () => {
  assert.equal(getValidatedSessionSecret(undefined, "development"), "dev-session-secret");
});

test("rejects too-short production secrets", () => {
  assert.throws(
    () => getValidatedSessionSecret("short-secret", "production"),
    /SESSION_SECRET must be a secure value/,
  );
});

test("rejects the .env.example production placeholder", () => {
  assert.throws(
    () => getValidatedSessionSecret("CHANGE_ME_run_openssl_rand_hex_32", "production"),
    /SESSION_SECRET must be a secure value/,
  );
});

test("rejects the development fallback 'dev-session-secret' in production", () => {
  assert.throws(
    () => getValidatedSessionSecret("dev-session-secret", "production"),
    /SESSION_SECRET must be a secure value/,
  );
});

test("rejects an unset SESSION_SECRET in production", () => {
  assert.throws(
    () => getValidatedSessionSecret(undefined, "production"),
    /SESSION_SECRET must be a secure value/,
  );
  assert.throws(
    () => getValidatedSessionSecret("", "production"),
    /SESSION_SECRET must be a secure value/,
  );
});

test("accepts a real production secret", () => {
  const secret = "4e0df7d204efc16f9d457d79725be193c5a70a6592cf0197c5f6b8d2a9bc0c11";
  assert.equal(getValidatedSessionSecret(secret, "production"), secret);
});
