import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { CSRF_REQUEST_HEADER_NAME } from "@/lib/auth/csrf";
import { extractClientIp } from "@/lib/rate-limit";

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const PASSWORD_RESET_RATE_LIMIT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// Forgot-password requests: tight per-email AND per-actor caps so anonymous
// senders cannot spam reset emails to a victim and so a single client cannot
// burn through token issuance against many emails.
export const PASSWORD_RESET_REQUEST_EMAIL_LIMIT = 5;
export const PASSWORD_RESET_REQUEST_ACTOR_LIMIT = 10;

// Reset attempts (POST /api/auth/reset-password): per-token cap defends against
// guessing a known token; per-actor cap defends against brute force from a
// single client; per-actor+token cap further hardens shared anonymous browsers.
export const PASSWORD_RESET_ATTEMPT_TOKEN_LIMIT = 10;
export const PASSWORD_RESET_ATTEMPT_ACTOR_LIMIT = 20;
export const PASSWORD_RESET_ATTEMPT_ACTOR_TOKEN_LIMIT = 8;

const ACTION = {
  requestEmail: "password_reset_request_email",
  requestActor: "password_reset_request_actor",
  attemptToken: "password_reset_attempt_token",
  attemptActor: "password_reset_attempt_actor",
  attemptActorToken: "password_reset_attempt_actor_token",
} as const;

type Reservation = {
  action: string;
  keyHash: string;
  limit: number;
  windowMs: number;
};

function hashKey(parts: Array<string | null | undefined>) {
  return crypto
    .createHash("sha256")
    .update(parts.map((part) => part ?? "").join("\0"))
    .digest("hex");
}

function reservation(
  action: string,
  parts: Array<string | null | undefined>,
  limit: number,
  windowMs = RATE_LIMIT_WINDOW_MS,
): Reservation {
  return { action, keyHash: hashKey(parts), limit, windowMs };
}

async function reserveAtomic(reservations: Reservation[]) {
  const uniqueReservations = Array.from(
    new Map(reservations.map((item) => [`${item.action}:${item.keyHash}`, item])).values(),
  ).sort((left, right) =>
    `${left.action}:${left.keyHash}`.localeCompare(`${right.action}:${right.keyHash}`),
  );

  return prisma.$transaction(
    async (tx) => {
      for (const item of uniqueReservations) {
        const lockKey = `${item.action}:${item.keyHash}`;
        await tx.$queryRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text`,
        );
      }

      for (const item of uniqueReservations) {
        const count = await tx.passwordResetRateLimitAttempt.count({
          where: {
            action: item.action,
            keyHash: item.keyHash,
            createdAt: { gte: new Date(Date.now() - item.windowMs) },
          },
        });
        if (count >= item.limit) return false;
      }

      await tx.passwordResetRateLimitAttempt.createMany({
        data: uniqueReservations.map((item) => ({
          action: item.action,
          keyHash: item.keyHash,
        })),
      });
      return true;
    },
    { maxWait: 10_000, timeout: 10_000 },
  );
}

export function getPasswordResetActorKeys(input: {
  email?: string | null;
  ip?: string | null;
  fingerprint?: string | null;
}) {
  const identity = [
    input.email ? `email:${input.email.trim().toLowerCase()}` : null,
    input.ip ? `ip:${input.ip}` : null,
  ].filter((value): value is string => Boolean(value));
  const keys = [
    ...identity,
    input.fingerprint ? `fingerprint:${input.fingerprint}` : null,
  ].filter((value): value is string => Boolean(value));
  return Array.from(new Set(keys));
}

export function getPasswordResetRequestActorKeys(
  request: Request,
  input: { email?: string | null } = {},
) {
  return getPasswordResetActorKeys({
    ...input,
    ip: extractClientIp(request),
    fingerprint: request.headers.get(CSRF_REQUEST_HEADER_NAME),
  });
}

export async function reservePasswordResetRequest(
  emailKey: string,
  actorKeys: string[],
) {
  return reserveAtomic([
    reservation(
      ACTION.requestEmail,
      [emailKey.trim().toLowerCase()],
      PASSWORD_RESET_REQUEST_EMAIL_LIMIT,
    ),
    ...actorKeys.map((actorKey) =>
      reservation(ACTION.requestActor, [actorKey], PASSWORD_RESET_REQUEST_ACTOR_LIMIT),
    ),
  ]);
}

export async function reservePasswordResetAttempt(
  tokenHash: string,
  actorKeys: string[],
) {
  return reserveAtomic([
    reservation(
      ACTION.attemptToken,
      [tokenHash],
      PASSWORD_RESET_ATTEMPT_TOKEN_LIMIT,
    ),
    ...actorKeys.flatMap((actorKey) => [
      reservation(ACTION.attemptActor, [actorKey], PASSWORD_RESET_ATTEMPT_ACTOR_LIMIT),
      reservation(
        ACTION.attemptActorToken,
        [actorKey, tokenHash],
        PASSWORD_RESET_ATTEMPT_ACTOR_TOKEN_LIMIT,
      ),
    ]),
  ]);
}

export async function cleanupPasswordResetRateLimitAttempts(
  before = new Date(Date.now() - PASSWORD_RESET_RATE_LIMIT_RETENTION_MS),
) {
  return prisma.passwordResetRateLimitAttempt.deleteMany({
    where: { createdAt: { lt: before } },
  });
}
