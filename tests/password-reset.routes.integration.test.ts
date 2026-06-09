import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { prisma } from "../lib/db/prisma";
import { hashPassword, verifyPassword } from "../lib/auth/password";
import { POST as forgotPasswordHandler } from "../app/api/auth/forgot-password/route";
import { POST as resetPasswordHandler } from "../app/api/auth/reset-password/route";
import { assertSafeTestDatabase } from "./helpers/test-database";

assertSafeTestDatabase();

const env = process.env as Record<string, string | undefined>;
const ENV_KEYS = [
  "NODE_ENV",
  "SMTP_ENABLED",
  "DEV_SHOW_VERIFICATION_LINKS",
  "APP_BASE_URL",
] as const;

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

function makeJsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readJson(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

const FORGOT_URL = "https://app.test/api/auth/forgot-password";
const RESET_URL = "https://app.test/api/auth/reset-password";
const APP_BASE = "https://app.test";

// Match the phase3_5 suite: clear any stale rate-limit rows up front so per-email
// cap assertions are not affected by prior runs that aborted before cleanup.
before(async () => {
  await prisma.$connect();
  await prisma.passwordResetRateLimitAttempt.deleteMany({});
});

after(async () => {
  await prisma.$disconnect();
});

test("forgot-password returns identical body shape for existing and unknown emails", async () => {
  const snapshot = snapshotEnv();
  try {
    env.NODE_ENV = "development";
    env.SMTP_ENABLED = "false";
    env.DEV_SHOW_VERIFICATION_LINKS = "true";
    env.APP_BASE_URL = APP_BASE;

    const knownEmail = `enum-known-${crypto.randomUUID()}@example.com`;
    const unknownEmail = `enum-unknown-${crypto.randomUUID()}@example.com`;
    const user = await prisma.user.create({
      data: {
        name: "Enum Known",
        email: knownEmail,
        passwordHash: await hashPassword("KnownPass1!"),
      },
    });

    try {
      const knownResp = await forgotPasswordHandler(
        makeJsonRequest(FORGOT_URL, { email: knownEmail }),
      );
      const unknownResp = await forgotPasswordHandler(
        makeJsonRequest(FORGOT_URL, { email: unknownEmail }),
      );
      const knownJson = await readJson(knownResp);
      const unknownJson = await readJson(unknownResp);

      assert.equal(knownResp.status, 202);
      assert.equal(unknownResp.status, 202);
      assert.equal(knownJson.data.status, "sent");
      assert.equal(unknownJson.data.status, "sent");
      assert.equal(knownJson.data.message, unknownJson.data.message);

      // Known email got a preview URL (dev), unknown did NOT — but the message
      // is identical. The preview URL field absence vs presence is a
      // dev-only convenience and is not exposed in production paths; the
      // production test below covers that.
      assert.ok(knownJson.data.previewUrl, "Known user gets preview URL in dev mode");
      assert.equal(unknownJson.data.previewUrl, undefined);

      // The known user has exactly one active reset token created.
      const tokens = await prisma.passwordResetToken.findMany({
        where: { userId: user.id, usedAt: null },
      });
      assert.equal(tokens.length, 1);
    } finally {
      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await prisma.auditLog.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.passwordResetRateLimitAttempt.deleteMany({});
    }
  } finally {
    restoreEnv(snapshot);
  }
});

test("forgot-password never returns previewUrl in production", async () => {
  const snapshot = snapshotEnv();
  try {
    env.NODE_ENV = "production";
    env.SMTP_ENABLED = "false";
    env.DEV_SHOW_VERIFICATION_LINKS = "true";
    env.APP_BASE_URL = APP_BASE;

    const knownEmail = `prod-${crypto.randomUUID()}@example.com`;
    const user = await prisma.user.create({
      data: {
        name: "Prod Known",
        email: knownEmail,
        passwordHash: await hashPassword("ProdPass1!"),
      },
    });

    try {
      const response = await forgotPasswordHandler(
        makeJsonRequest(FORGOT_URL, { email: knownEmail }),
      );
      const json = await readJson(response);
      // Generic body: production with SMTP disabled raises
      // EmailDeliveryUnavailableError, which the route handler swallows into
      // the generic 202 to avoid leaking account existence. The previewUrl
      // must NEVER be present in production responses.
      assert.equal(response.status, 202);
      assert.equal(json.data.status, "sent");
      assert.equal(json.data.previewUrl, undefined);
    } finally {
      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await prisma.auditLog.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.passwordResetRateLimitAttempt.deleteMany({});
    }
  } finally {
    restoreEnv(snapshot);
  }
});

test("reset-password full happy path: old password rejected, new password works, token unreusable", async () => {
  const snapshot = snapshotEnv();
  try {
    env.NODE_ENV = "development";
    env.SMTP_ENABLED = "false";
    env.DEV_SHOW_VERIFICATION_LINKS = "true";
    env.APP_BASE_URL = APP_BASE;

    const email = `happy-${crypto.randomUUID()}@example.com`;
    const oldPassword = "OldPass1!";
    const user = await prisma.user.create({
      data: {
        name: "Happy Path",
        email,
        passwordHash: await hashPassword(oldPassword),
      },
    });

    try {
      // Issue the token through the real route so the preview URL is what
      // the user would receive.
      const forgotResp = await forgotPasswordHandler(
        makeJsonRequest(FORGOT_URL, { email }),
      );
      assert.equal(forgotResp.status, 202);
      const forgotJson = await readJson(forgotResp);
      const previewUrl = forgotJson.data.previewUrl as string;
      assert.ok(previewUrl);
      const token = new URL(previewUrl).searchParams.get("token");
      assert.ok(token);

      // Perform the reset.
      const newPassword = "NewPass1!";
      const resetResp = await resetPasswordHandler(
        makeJsonRequest(RESET_URL, {
          token,
          password: newPassword,
          confirmPassword: newPassword,
        }),
      );
      const resetJson = await readJson(resetResp);
      assert.equal(resetResp.status, 200);
      assert.equal(resetJson.data.status, "password_reset");

      const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      assert.equal(await verifyPassword(newPassword, refreshed.passwordHash!), true);
      assert.equal(await verifyPassword(oldPassword, refreshed.passwordHash!), false);

      // Reusing the same token must fail with the generic invalid message.
      const replayResp = await resetPasswordHandler(
        makeJsonRequest(RESET_URL, {
          token,
          password: newPassword,
          confirmPassword: newPassword,
        }),
      );
      assert.equal(replayResp.status, 400);
      const replayJson = await readJson(replayResp);
      assert.match(replayJson.error.message, /invalid|expired/i);
    } finally {
      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await prisma.auditLog.deleteMany({ where: { userId: user.id } });
      await prisma.session.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.passwordResetRateLimitAttempt.deleteMany({});
    }
  } finally {
    restoreEnv(snapshot);
  }
});

test("reset-password rejects unknown token with the same body it returns for malformed ones", async () => {
  const snapshot = snapshotEnv();
  try {
    env.NODE_ENV = "development";
    env.SMTP_ENABLED = "false";
    env.APP_BASE_URL = APP_BASE;

    const unknown = "a".repeat(64);
    const malformed = "a".repeat(32) + "!"; // invalid char per token regex

    const unknownResp = await resetPasswordHandler(
      makeJsonRequest(RESET_URL, {
        token: unknown,
        password: "NewPass1!",
        confirmPassword: "NewPass1!",
      }),
    );
    const malformedResp = await resetPasswordHandler(
      makeJsonRequest(RESET_URL, {
        token: malformed,
        password: "NewPass1!",
        confirmPassword: "NewPass1!",
      }),
    );
    assert.equal(unknownResp.status, 400);
    assert.equal(malformedResp.status, 400);
    const unknownJson = await readJson(unknownResp);
    const malformedJson = await readJson(malformedResp);
    assert.equal(unknownJson.error.message, malformedJson.error.message);
    await prisma.passwordResetRateLimitAttempt.deleteMany({});
  } finally {
    restoreEnv(snapshot);
  }
});

test("OAuth-only user can set a password by completing the full route flow", async () => {
  const snapshot = snapshotEnv();
  try {
    env.NODE_ENV = "development";
    env.SMTP_ENABLED = "false";
    env.DEV_SHOW_VERIFICATION_LINKS = "true";
    env.APP_BASE_URL = APP_BASE;

    const email = `oauth-route-${crypto.randomUUID()}@example.com`;
    const user = await prisma.user.create({
      data: { name: "OAuth Only", email, passwordHash: null },
    });

    try {
      const forgotResp = await forgotPasswordHandler(
        makeJsonRequest(FORGOT_URL, { email }),
      );
      const forgotJson = await readJson(forgotResp);
      const previewUrl = forgotJson.data.previewUrl as string;
      const token = new URL(previewUrl).searchParams.get("token");
      assert.ok(token);

      const newPassword = "CanLogin1!";
      const resetResp = await resetPasswordHandler(
        makeJsonRequest(RESET_URL, {
          token,
          password: newPassword,
          confirmPassword: newPassword,
        }),
      );
      assert.equal(resetResp.status, 200);

      const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      assert.notEqual(refreshed.passwordHash, null);
      assert.equal(await verifyPassword(newPassword, refreshed.passwordHash!), true);
    } finally {
      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await prisma.auditLog.deleteMany({ where: { userId: user.id } });
      await prisma.session.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.passwordResetRateLimitAttempt.deleteMany({});
    }
  } finally {
    restoreEnv(snapshot);
  }
});

test("forgot-password rate limit returns 429 after the per-email cap", async () => {
  const snapshot = snapshotEnv();
  try {
    env.NODE_ENV = "development";
    env.SMTP_ENABLED = "false";
    env.DEV_SHOW_VERIFICATION_LINKS = "true";
    env.APP_BASE_URL = APP_BASE;

    const email = `rate-route-${crypto.randomUUID()}@example.com`;
    const user = await prisma.user.create({
      data: {
        name: "Rate Route",
        email,
        passwordHash: await hashPassword("RatePass1!"),
      },
    });

    try {
      let lastStatus = 0;
      // 5 should be allowed (PASSWORD_RESET_REQUEST_EMAIL_LIMIT), and the 6th
      // should be 429 because of the per-email cap regardless of actor key.
      for (let index = 0; index < 6; index += 1) {
        const resp = await forgotPasswordHandler(
          makeJsonRequest(FORGOT_URL, { email }),
        );
        lastStatus = resp.status;
      }
      assert.equal(lastStatus, 429);
    } finally {
      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await prisma.auditLog.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.passwordResetRateLimitAttempt.deleteMany({});
    }
  } finally {
    restoreEnv(snapshot);
  }
});

test("audit logs never contain raw reset tokens", async () => {
  const snapshot = snapshotEnv();
  try {
    env.NODE_ENV = "development";
    env.SMTP_ENABLED = "false";
    env.DEV_SHOW_VERIFICATION_LINKS = "true";
    env.APP_BASE_URL = APP_BASE;

    const email = `audit-${crypto.randomUUID()}@example.com`;
    const user = await prisma.user.create({
      data: {
        name: "Audit",
        email,
        passwordHash: await hashPassword("AuditPass1!"),
      },
    });

    try {
      const forgotResp = await forgotPasswordHandler(
        makeJsonRequest(FORGOT_URL, { email }),
      );
      const forgotJson = await readJson(forgotResp);
      const previewUrl = forgotJson.data.previewUrl as string;
      const token = new URL(previewUrl).searchParams.get("token");
      assert.ok(token);

      await resetPasswordHandler(
        makeJsonRequest(RESET_URL, {
          token,
          password: "FreshPass1!",
          confirmPassword: "FreshPass1!",
        }),
      );

      const entries = await prisma.auditLog.findMany({
        where: { userId: user.id },
      });
      assert.ok(entries.length >= 1);
      for (const entry of entries) {
        const serialized = JSON.stringify(entry.metadata ?? {});
        assert.equal(
          serialized.includes(token),
          false,
          `Audit log must not contain raw reset token: ${entry.action} ${serialized}`,
        );
      }
    } finally {
      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await prisma.auditLog.deleteMany({ where: { userId: user.id } });
      await prisma.session.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.passwordResetRateLimitAttempt.deleteMany({});
    }
  } finally {
    restoreEnv(snapshot);
  }
});
