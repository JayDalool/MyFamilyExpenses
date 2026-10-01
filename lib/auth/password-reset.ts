import crypto from "node:crypto";
import { Prisma, type PasswordResetToken } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { buildInternalUrl } from "@/lib/auth/app-url";

const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
export const PASSWORD_RESET_TOKEN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// Truncated SHA-256 of the IP / UA. The values are stored only for forensic
// correlation; truncation makes targeted re-identification harder while still
// supporting rate-limit incident review. They are NEVER returned to clients
// and never used as comparison material for token validation.
const REQUEST_METADATA_HASH_BYTES = 16;

export class PasswordResetTokenError extends Error {
  constructor(public readonly reason: "invalid" | "expired" | "used") {
    super(`Password reset token ${reason}.`);
    this.name = "PasswordResetTokenError";
  }
}

export function createPasswordResetToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashPasswordResetToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function hashRequestMetadata(value: string | null | undefined) {
  if (!value) return null;
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex")
    .slice(0, REQUEST_METADATA_HASH_BYTES * 2);
}

export function getPasswordResetExpiry() {
  return new Date(Date.now() + PASSWORD_RESET_TTL_MS);
}

export function buildPasswordResetUrl(token: string, fallbackUrl?: string) {
  return buildInternalUrl(
    `/auth/reset-password?token=${encodeURIComponent(token)}`,
    fallbackUrl,
  ).toString();
}

type IssueTokenInput = {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Issue a new password reset token in a transaction. Older active tokens for
 * the same user are invalidated (`used_at` stamped) so only the most recent
 * link works — this is the standard "issuing a new link invalidates older
 * ones" behavior expected by users.
 */
export async function issuePasswordResetToken(input: IssueTokenInput) {
  const token = createPasswordResetToken();
  const tokenHash = hashPasswordResetToken(token);
  const expiresAt = getPasswordResetExpiry();

  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.updateMany({
      where: { userId: input.userId, usedAt: null },
      data: { usedAt: new Date() },
    });
    await tx.passwordResetToken.create({
      data: {
        userId: input.userId,
        tokenHash,
        expiresAt,
        requestedIpHash: hashRequestMetadata(input.ip),
        requestedUserAgentHash: hashRequestMetadata(input.userAgent),
      },
    });
  });

  return { token, tokenHash, expiresAt };
}

/**
 * Validate a raw token without consuming it. Returns the token row when valid
 * for display purposes (e.g. showing the reset form). Never use this in place
 * of consumePasswordResetToken for actually applying the new password.
 */
export async function findValidPasswordResetTokenByRaw(rawToken: string) {
  const tokenHash = hashPasswordResetToken(rawToken);
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });
  if (!row) return null;
  if (row.usedAt) return null;
  if (row.expiresAt <= new Date()) return null;
  return row;
}

type ConsumeResult = {
  token: Pick<PasswordResetToken, "id" | "userId">;
};

/**
 * Atomically mark a not-yet-used, not-yet-expired token as used and return its
 * userId. Throws PasswordResetTokenError on miss so callers can render the
 * same generic invalid message regardless of root cause.
 *
 * Must be called inside the same transaction that updates the user password
 * so a crash between the two can never leave a consumed-but-unapplied token.
 */
export async function consumePasswordResetTokenInTransaction(
  tx: Prisma.TransactionClient,
  rawToken: string,
): Promise<ConsumeResult> {
  const tokenHash = hashPasswordResetToken(rawToken);
  const consumed = await tx.$queryRaw<Array<{ id: string; user_id: string }>>(
    Prisma.sql`
      UPDATE "password_reset_tokens"
      SET "used_at" = CURRENT_TIMESTAMP
      WHERE "token_hash" = ${tokenHash}
        AND "used_at" IS NULL
        AND "expires_at" > CURRENT_TIMESTAMP
      RETURNING "id", "user_id"
    `,
  );

  if (consumed.length !== 1) {
    throw new PasswordResetTokenError("invalid");
  }
  return { token: { id: consumed[0].id, userId: consumed[0].user_id } };
}

/**
 * Invalidate any other active tokens for this user (including any that might
 * have been issued just after the current token).
 */
export async function invalidateOtherActiveTokens(
  tx: Prisma.TransactionClient,
  userId: string,
  exceptTokenId: string,
) {
  await tx.passwordResetToken.updateMany({
    where: { userId, usedAt: null, NOT: { id: exceptTokenId } },
    data: { usedAt: new Date() },
  });
}

/**
 * After a successful reset, terminate every session belonging to the user.
 * They will have to sign in with the new password. We avoid leaving a logged-in
 * session around because it could belong to an attacker who still had a valid
 * cookie at reset time.
 */
export async function invalidateAllSessionsForUser(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  await tx.session.deleteMany({ where: { userId } });
}

/**
 * Hygiene helper: drop reset token rows that are either fully expired and
 * past retention, OR were consumed and past retention. We keep recent
 * already-used rows for audit/forensic correlation (the row's `used_at` and
 * `requested_ip_hash` confirm to operators which session burned the link).
 */
export async function cleanupExpiredPasswordResetTokens(
  before: Date = new Date(Date.now() - PASSWORD_RESET_TOKEN_RETENTION_MS),
) {
  return prisma.passwordResetToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: before } },
        { usedAt: { lt: before } },
      ],
    },
  });
}
