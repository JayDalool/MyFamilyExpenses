import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSignupVerificationUrl,
  createSignupVerificationToken,
  getSignupVerificationExpiry,
  hashSignupVerificationToken,
} from "../lib/auth/signup-verification";

test("createSignupVerificationToken returns a random 64-character hex string", () => {
  const token = createSignupVerificationToken();

  assert.equal(token.length, 64);
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.notEqual(token, createSignupVerificationToken());
});

test("hashSignupVerificationToken is deterministic and non-reversible length", () => {
  const token = "abc123";
  const first = hashSignupVerificationToken(token);
  const second = hashSignupVerificationToken(token);

  assert.equal(first, second);
  assert.equal(first.length, 64);
  assert.notEqual(first, token);
});

test("getSignupVerificationExpiry is roughly 24 hours in the future", () => {
  const before = Date.now();
  const expiry = getSignupVerificationExpiry().getTime();
  const after = Date.now();

  assert.ok(expiry >= before + 23 * 60 * 60 * 1000);
  assert.ok(expiry <= after + 24 * 60 * 60 * 1000 + 5_000);
});

test("buildSignupVerificationUrl uses the configured app base URL", () => {
  const previous = process.env.APP_BASE_URL;

  try {
    process.env.APP_BASE_URL = "https://your-app.example.com";

    const url = buildSignupVerificationUrl("sample-token");

    assert.equal(
      url,
      "https://your-app.example.com/api/auth/signup/verify?token=sample-token",
    );
  } finally {
    process.env.APP_BASE_URL = previous;
  }
});
