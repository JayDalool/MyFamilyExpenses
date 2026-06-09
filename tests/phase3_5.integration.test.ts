import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { prisma } from "../lib/db/prisma";
import { hashPassword, verifyPassword } from "../lib/auth/password";
import {
  buildPasswordResetUrl,
  cleanupExpiredPasswordResetTokens,
  consumePasswordResetTokenInTransaction,
  createPasswordResetToken,
  findValidPasswordResetTokenByRaw,
  hashPasswordResetToken,
  hashRequestMetadata,
  invalidateAllSessionsForUser,
  invalidateOtherActiveTokens,
  issuePasswordResetToken,
  PASSWORD_RESET_TOKEN_RETENTION_MS,
  PasswordResetTokenError,
} from "../lib/auth/password-reset";
import {
  PASSWORD_RESET_ATTEMPT_ACTOR_TOKEN_LIMIT,
  PASSWORD_RESET_REQUEST_EMAIL_LIMIT,
  cleanupPasswordResetRateLimitAttempts,
  reservePasswordResetAttempt,
  reservePasswordResetRequest,
} from "../lib/auth/password-reset-rate-limit";
import { createRawSessionToken } from "../lib/auth/session";
import { assertSafeTestDatabase } from "./helpers/test-database";

assertSafeTestDatabase();
const integrationTest = test;

async function createUserWithPassword(label: string) {
  const password = "OriginalPass1!";
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      name: `Reset ${label}`,
      email: `reset-${label}-${crypto.randomUUID()}@example.com`,
      passwordHash,
    },
  });
  return { user, password };
}

async function createOAuthOnlyUser(label: string) {
  return prisma.user.create({
    data: {
      name: `OAuth ${label}`,
      email: `oauth-${label}-${crypto.randomUUID()}@example.com`,
      passwordHash: null,
    },
  });
}

async function cleanupUserAndArtifacts(userIds: string[]) {
  assertSafeTestDatabase();
  if (userIds.length === 0) return;
  await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

// Suite isolation: drop any residual password-reset rate-limit rows so that
// per-email / per-actor cap tests start from a known empty state. Even though
// the test runner is configured for serial execution (--test-concurrency=1)
// in package.json, this guards against developers invoking the file directly
// after a flaky aborted run.
before(async () => {
  await prisma.$connect();
  await prisma.passwordResetRateLimitAttempt.deleteMany({});
});

after(async () => {
  await prisma.$disconnect();
});

integrationTest("reset token is stored as a SHA-256 hash, never raw", async () => {
  const { user } = await createUserWithPassword("hash");
  try {
    const { token } = await issuePasswordResetToken({ userId: user.id });
    const stored = await prisma.passwordResetToken.findFirstOrThrow({
      where: { userId: user.id },
    });
    assert.equal(stored.tokenHash, hashPasswordResetToken(token));
    assert.notEqual(stored.tokenHash, token);
    assert.ok(stored.tokenHash.length === 64); // sha256 hex
  } finally {
    await cleanupUserAndArtifacts([user.id]);
  }
});

integrationTest("expired reset token cannot be consumed", async () => {
  const { user } = await createUserWithPassword("expired");
  try {
    const token = createPasswordResetToken();
    const tokenHash = hashPasswordResetToken(token);
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    assert.equal(await findValidPasswordResetTokenByRaw(token), null);

    await assert.rejects(
      prisma.$transaction((tx) => consumePasswordResetTokenInTransaction(tx, token)),
      (error: unknown) =>
        error instanceof PasswordResetTokenError && error.reason === "invalid",
    );
  } finally {
    await cleanupUserAndArtifacts([user.id]);
  }
});

integrationTest("used reset token cannot be consumed twice", async () => {
  const { user } = await createUserWithPassword("used");
  try {
    const { token } = await issuePasswordResetToken({ userId: user.id });
    const newHash = await hashPassword("BrandNewPass1!");
    await prisma.$transaction(async (tx) => {
      const { token: consumed } = await consumePasswordResetTokenInTransaction(tx, token);
      await tx.user.update({
        where: { id: consumed.userId },
        data: { passwordHash: newHash },
      });
    });

    assert.equal(await findValidPasswordResetTokenByRaw(token), null);
    await assert.rejects(
      prisma.$transaction((tx) => consumePasswordResetTokenInTransaction(tx, token)),
      (error: unknown) =>
        error instanceof PasswordResetTokenError && error.reason === "invalid",
    );
  } finally {
    await cleanupUserAndArtifacts([user.id]);
  }
});

integrationTest("invalid/unknown reset token is rejected", async () => {
  const rogueToken = createPasswordResetToken();
  assert.equal(await findValidPasswordResetTokenByRaw(rogueToken), null);
  await assert.rejects(
    prisma.$transaction((tx) =>
      consumePasswordResetTokenInTransaction(tx, rogueToken),
    ),
    (error: unknown) =>
      error instanceof PasswordResetTokenError && error.reason === "invalid",
  );
});

integrationTest("successful reset updates password and invalidates sessions", async () => {
  const { user, password: oldPassword } = await createUserWithPassword("success");
  const userIds = [user.id];
  try {
    // Pre-create two sessions so we can prove they get cleared.
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: createRawSessionToken(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: createRawSessionToken(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const { token } = await issuePasswordResetToken({ userId: user.id });
    const newPassword = "BrandNewPass1!";
    const newHash = await hashPassword(newPassword);

    await prisma.$transaction(async (tx) => {
      const { token: consumed } = await consumePasswordResetTokenInTransaction(tx, token);
      await tx.user.update({
        where: { id: consumed.userId },
        data: { passwordHash: newHash },
      });
      await invalidateOtherActiveTokens(tx, consumed.userId, consumed.id);
      await invalidateAllSessionsForUser(tx, consumed.userId);
    });

    const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.notEqual(refreshed.passwordHash, null);
    assert.equal(await verifyPassword(newPassword, refreshed.passwordHash!), true);
    assert.equal(await verifyPassword(oldPassword, refreshed.passwordHash!), false);

    const remainingSessions = await prisma.session.count({ where: { userId: user.id } });
    assert.equal(remainingSessions, 0);
  } finally {
    await cleanupUserAndArtifacts(userIds);
  }
});

integrationTest("issuing a new reset token invalidates older active tokens", async () => {
  const { user } = await createUserWithPassword("supersede");
  try {
    const first = await issuePasswordResetToken({ userId: user.id });
    const second = await issuePasswordResetToken({ userId: user.id });

    assert.notEqual(first.token, second.token);

    // Older token must no longer be considered valid.
    assert.equal(await findValidPasswordResetTokenByRaw(first.token), null);
    assert.ok(await findValidPasswordResetTokenByRaw(second.token));

    // Old token also cannot be consumed.
    await assert.rejects(
      prisma.$transaction((tx) =>
        consumePasswordResetTokenInTransaction(tx, first.token),
      ),
      (error: unknown) =>
        error instanceof PasswordResetTokenError && error.reason === "invalid",
    );
  } finally {
    await cleanupUserAndArtifacts([user.id]);
  }
});

integrationTest("OAuth-only user can set a password via reset", async () => {
  const oauthUser = await createOAuthOnlyUser("set-password");
  try {
    assert.equal(oauthUser.passwordHash, null);

    const { token } = await issuePasswordResetToken({ userId: oauthUser.id });
    const newPassword = "ChosenLater1!";
    const newHash = await hashPassword(newPassword);

    await prisma.$transaction(async (tx) => {
      const { token: consumed } = await consumePasswordResetTokenInTransaction(tx, token);
      await tx.user.update({
        where: { id: consumed.userId },
        data: { passwordHash: newHash },
      });
    });

    const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: oauthUser.id } });
    assert.notEqual(refreshed.passwordHash, null);
    assert.equal(await verifyPassword(newPassword, refreshed.passwordHash!), true);
  } finally {
    await cleanupUserAndArtifacts([oauthUser.id]);
  }
});

integrationTest("forgot-password request rate limit caps per-email attempts", async () => {
  const email = `rate-${crypto.randomUUID()}@example.com`;
  const actorKey = [`ip:10.10.10.${crypto.randomUUID()}`];
  const startedAt = new Date();

  try {
    let allowed = 0;
    for (let index = 0; index < PASSWORD_RESET_REQUEST_EMAIL_LIMIT + 3; index += 1) {
      const granted = await reservePasswordResetRequest(email, [
        ...actorKey,
        `fingerprint:rate-${crypto.randomUUID()}`,
      ]);
      if (granted) allowed += 1;
    }
    assert.equal(allowed, PASSWORD_RESET_REQUEST_EMAIL_LIMIT);
  } finally {
    // Scoped cleanup: only rows this test produced. This prevents a stray
    // table-wide deleteMany from clobbering a concurrent test's accumulator.
    await prisma.passwordResetRateLimitAttempt.deleteMany({
      where: { createdAt: { gte: startedAt } },
    });
  }
});

integrationTest("reset attempt actor+token cap rejects brute force", async () => {
  const tokenHash = hashPasswordResetToken(createPasswordResetToken());
  const actorKey = [`ip:10.0.0.${crypto.randomUUID()}`, `fingerprint:reset-brute-${crypto.randomUUID()}`];
  const startedAt = new Date();
  try {
    let allowed = 0;
    for (let index = 0; index < PASSWORD_RESET_ATTEMPT_ACTOR_TOKEN_LIMIT + 5; index += 1) {
      const granted = await reservePasswordResetAttempt(tokenHash, actorKey);
      if (granted) allowed += 1;
    }
    assert.equal(allowed, PASSWORD_RESET_ATTEMPT_ACTOR_TOKEN_LIMIT);
  } finally {
    await prisma.passwordResetRateLimitAttempt.deleteMany({
      where: { createdAt: { gte: startedAt } },
    });
  }
});

integrationTest("parallel password-reset reservations cannot exceed per-actor+token cap", async () => {
  // Concurrency proof: fire many parallel attempts; the atomic advisory-lock
  // + count-then-insert in reserveAtomic must still let no more than
  // PASSWORD_RESET_ATTEMPT_ACTOR_TOKEN_LIMIT succeed.
  const tokenHash = hashPasswordResetToken(createPasswordResetToken());
  const actorKey = [
    `ip:10.99.99.${crypto.randomUUID()}`,
    `fingerprint:concurrent-${crypto.randomUUID()}`,
  ];
  const startedAt = new Date();
  try {
    const results = await Promise.all(
      Array.from({ length: PASSWORD_RESET_ATTEMPT_ACTOR_TOKEN_LIMIT + 10 }, () =>
        reservePasswordResetAttempt(tokenHash, actorKey),
      ),
    );
    assert.equal(
      results.filter(Boolean).length,
      PASSWORD_RESET_ATTEMPT_ACTOR_TOKEN_LIMIT,
    );
  } finally {
    await prisma.passwordResetRateLimitAttempt.deleteMany({
      where: { createdAt: { gte: startedAt } },
    });
  }
});

integrationTest("cleanupExpiredPasswordResetTokens drops past-retention rows but keeps live ones", async () => {
  const now = Date.now();
  const longAgo = new Date(now - PASSWORD_RESET_TOKEN_RETENTION_MS - 60_000);
  const user = await prisma.user.create({
    data: {
      name: "Cleanup Tokens",
      email: `cleanup-tokens-${crypto.randomUUID()}@example.com`,
      passwordHash: await hashPassword("CleanupPass1!"),
    },
  });
  const stillValid = createPasswordResetToken();
  const recentlyUsed = createPasswordResetToken();
  const expiredPastRetention = createPasswordResetToken();
  const usedPastRetention = createPasswordResetToken();

  try {
    await prisma.passwordResetToken.createMany({
      data: [
        {
          userId: user.id,
          tokenHash: hashPasswordResetToken(stillValid),
          expiresAt: new Date(now + 60_000),
        },
        {
          userId: user.id,
          tokenHash: hashPasswordResetToken(recentlyUsed),
          expiresAt: new Date(now + 60_000),
          usedAt: new Date(now - 60_000),
        },
        {
          userId: user.id,
          tokenHash: hashPasswordResetToken(expiredPastRetention),
          expiresAt: longAgo,
        },
        {
          userId: user.id,
          tokenHash: hashPasswordResetToken(usedPastRetention),
          expiresAt: new Date(now + 60_000),
          usedAt: longAgo,
        },
      ],
    });

    const deleted = await cleanupExpiredPasswordResetTokens();
    assert.equal(deleted.count, 2);
    const remaining = await prisma.passwordResetToken.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    const remainingHashes = new Set(remaining.map((row) => row.tokenHash));
    assert.equal(remainingHashes.has(hashPasswordResetToken(stillValid)), true);
    assert.equal(remainingHashes.has(hashPasswordResetToken(recentlyUsed)), true);
    assert.equal(remainingHashes.has(hashPasswordResetToken(expiredPastRetention)), false);
    assert.equal(remainingHashes.has(hashPasswordResetToken(usedPastRetention)), false);
  } finally {
    await cleanupUserAndArtifacts([user.id]);
  }
});

integrationTest("rate-limit cleanup removes only rows older than retention boundary", async () => {
  const boundary = new Date("2026-06-01T00:00:00.000Z");
  await prisma.passwordResetRateLimitAttempt.createMany({
    data: [
      {
        action: "cleanup-test",
        keyHash: hashPasswordResetToken("old"),
        createdAt: new Date("2026-05-31T23:59:59.000Z"),
      },
      {
        action: "cleanup-test",
        keyHash: hashPasswordResetToken("recent"),
        createdAt: boundary,
      },
    ],
  });
  try {
    assert.equal((await cleanupPasswordResetRateLimitAttempts(boundary)).count, 1);
    assert.equal(
      await prisma.passwordResetRateLimitAttempt.count({
        where: { action: "cleanup-test", createdAt: { gte: boundary } },
      }),
      1,
    );
  } finally {
    await prisma.passwordResetRateLimitAttempt.deleteMany({ where: { action: "cleanup-test" } });
  }
});

integrationTest("audit logs and request metadata never contain raw token or IP/UA strings", async () => {
  const { user } = await createUserWithPassword("audit");
  const ip = "203.0.113.42";
  const userAgent = "Mozilla/5.0 (Test Browser)";
  try {
    const { token } = await issuePasswordResetToken({
      userId: user.id,
      ip,
      userAgent,
    });
    const tokenHash = hashPasswordResetToken(token);

    const stored = await prisma.passwordResetToken.findFirstOrThrow({
      where: { userId: user.id },
    });
    assert.notEqual(stored.requestedIpHash, ip);
    assert.notEqual(stored.requestedUserAgentHash, userAgent);
    assert.equal(stored.requestedIpHash, hashRequestMetadata(ip));
    assert.equal(stored.requestedUserAgentHash, hashRequestMetadata(userAgent));

    // The forgot-password route writes an audit entry with only the hash; the
    // raw token is never persisted in audit metadata. We assert by checking
    // that the audit metadata format does not include the raw token.
    const allAudit = await prisma.auditLog.findMany({ where: { userId: user.id } });
    for (const entry of allAudit) {
      const serialized = JSON.stringify(entry.metadata ?? {});
      assert.equal(serialized.includes(token), false);
      assert.equal(serialized.includes(ip), false);
      assert.equal(serialized.includes(userAgent), false);
    }
    // (tokenHash and metadata hashes are fine to log; raw token is not.)
    assert.notEqual(tokenHash, token);
  } finally {
    await cleanupUserAndArtifacts([user.id]);
  }
});

integrationTest("buildPasswordResetUrl points at /auth/reset-password and URL-encodes the token", async () => {
  const previousBaseUrl = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = "https://example.test";
  try {
    const token = createPasswordResetToken();
    const url = buildPasswordResetUrl(token);
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/auth/reset-password");
    assert.equal(parsed.searchParams.get("token"), token);
    assert.equal(url.includes(token), true);
  } finally {
    if (previousBaseUrl === undefined) {
      delete process.env.APP_BASE_URL;
    } else {
      process.env.APP_BASE_URL = previousBaseUrl;
    }
  }
});
