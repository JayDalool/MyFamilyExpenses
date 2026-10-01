import assert from "node:assert/strict";
import test from "node:test";
import { EmailDeliveryUnavailableError, sendSignupVerificationEmail } from "../lib/email";

const env = process.env as Record<string, string | undefined>;
const ENV_KEYS = ["NODE_ENV", "SMTP_ENABLED", "DEV_SHOW_VERIFICATION_LINKS"] as const;

function snapshotEnv() {
  const snapshot: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  for (const key of ENV_KEYS) snapshot[key] = env[key];
  return snapshot;
}

function restoreEnv(snapshot: ReturnType<typeof snapshotEnv>) {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
}

test("returns previewUrl in development when SMTP is disabled and DEV_SHOW_VERIFICATION_LINKS=true", async () => {
  const snapshot = snapshotEnv();
  try {
    env.NODE_ENV = "development";
    env.SMTP_ENABLED = "false";
    env.DEV_SHOW_VERIFICATION_LINKS = "true";

    const result = await sendSignupVerificationEmail({
      email: "user@example.com",
      name: "Test User",
      verificationUrl: "http://localhost:3000/api/auth/signup/verify?token=abc",
    });

    assert.equal(
      result.previewUrl,
      "http://localhost:3000/api/auth/signup/verify?token=abc",
    );
  } finally {
    restoreEnv(snapshot);
  }
});

test("does NOT return previewUrl in development when DEV_SHOW_VERIFICATION_LINKS is unset", async () => {
  const snapshot = snapshotEnv();
  try {
    env.NODE_ENV = "development";
    env.SMTP_ENABLED = "false";
    delete env.DEV_SHOW_VERIFICATION_LINKS;

    const result = await sendSignupVerificationEmail({
      email: "user@example.com",
      name: "Test User",
      verificationUrl: "http://localhost:3000/api/auth/signup/verify?token=abc",
    });

    assert.equal(result.previewUrl, undefined);
  } finally {
    restoreEnv(snapshot);
  }
});

test("does NOT return previewUrl in development when DEV_SHOW_VERIFICATION_LINKS is anything other than 'true'", async () => {
  const snapshot = snapshotEnv();
  try {
    env.NODE_ENV = "development";
    env.SMTP_ENABLED = "false";
    env.DEV_SHOW_VERIFICATION_LINKS = "yes"; // not the exact string "true"

    const result = await sendSignupVerificationEmail({
      email: "user@example.com",
      name: "Test User",
      verificationUrl: "http://localhost:3000/api/auth/signup/verify?token=abc",
    });

    assert.equal(result.previewUrl, undefined);
  } finally {
    restoreEnv(snapshot);
  }
});

test("production fails closed when SMTP is disabled (no previewUrl, throws)", async () => {
  const snapshot = snapshotEnv();
  try {
    env.NODE_ENV = "production";
    env.SMTP_ENABLED = "false";
    delete env.DEV_SHOW_VERIFICATION_LINKS;

    await assert.rejects(
      () =>
        sendSignupVerificationEmail({
          email: "user@example.com",
          name: "Test User",
          verificationUrl: "https://your-app.example.com/api/auth/signup/verify?token=abc",
        }),
      EmailDeliveryUnavailableError,
    );
  } finally {
    restoreEnv(snapshot);
  }
});

test("production NEVER returns previewUrl, even when DEV_SHOW_VERIFICATION_LINKS=true", async () => {
  const snapshot = snapshotEnv();
  try {
    env.NODE_ENV = "production";
    env.SMTP_ENABLED = "false";
    env.DEV_SHOW_VERIFICATION_LINKS = "true";

    await assert.rejects(
      () =>
        sendSignupVerificationEmail({
          email: "user@example.com",
          name: "Test User",
          verificationUrl: "https://your-app.example.com/api/auth/signup/verify?token=abc",
        }),
      EmailDeliveryUnavailableError,
      "Production must fail closed instead of returning a preview URL",
    );
  } finally {
    restoreEnv(snapshot);
  }
});
