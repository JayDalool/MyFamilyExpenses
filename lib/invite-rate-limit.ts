import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { CSRF_REQUEST_HEADER_NAME } from "@/lib/auth/csrf";
import { prisma } from "@/lib/db/prisma";
import { extractClientIp } from "@/lib/rate-limit";

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const AUDIT_THROTTLE_WINDOW_MS = 60 * 60 * 1000;
export const INVITE_RATE_LIMIT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const INVITE_CREATION_LIMIT = 10;
export const INVITE_ACCEPTANCE_USER_LIMIT = 20;
export const INVITE_ACCEPTANCE_ACTOR_TOKEN_LIMIT = 8;
export const INVITE_ACCEPTANCE_TOKEN_LIMIT = 120;
export const INVITE_LOOKUP_ACTOR_LIMIT = 30;
export const INVITE_LOOKUP_TOKEN_LIMIT = 60;

// Per acceptable user, the flow can record up to 3 lookup attempts (preview page +
// signup or OAuth lookup + verify lookup) and 1 acceptance attempt. Token-wide caps
// must scale with maxUses so legitimate multi-use invites are not capped below
// maxUses. For unknown/unacceptable tokens the strict default caps still apply.
export const INVITE_LOOKUP_PER_USE_MULTIPLIER = 3;
export const INVITE_LOOKUP_TOKEN_BUFFER = 20;
export const INVITE_ACCEPTANCE_TOKEN_BUFFER = 20;

const ACTION = {
  creation: "invite_creation",
  acceptanceActor: "invite_acceptance_actor",
  acceptanceToken: "invite_acceptance_token",
  acceptanceActorToken: "invite_acceptance_actor_token",
  lookupActor: "invite_lookup_actor",
  lookupToken: "invite_lookup_token",
  failureAudit: "invite_failure_audit",
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
    new Map(
      reservations.map((item) => [`${item.action}:${item.keyHash}`, item]),
    ).values(),
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
        const count = await tx.inviteRateLimitAttempt.count({
          where: {
            action: item.action,
            keyHash: item.keyHash,
            createdAt: { gte: new Date(Date.now() - item.windowMs) },
          },
        });
        if (count >= item.limit) return false;
      }

      await tx.inviteRateLimitAttempt.createMany({
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

export function getInviteActorKeys(input: {
  userId?: string | null;
  email?: string | null;
  ip?: string | null;
  fingerprint?: string | null;
}) {
  const identityKeys = [
    input.userId ? `user:${input.userId}` : null,
    input.email ? `email:${input.email.trim().toLowerCase()}` : null,
    input.ip ? `ip:${input.ip}` : null,
  ].filter((value): value is string => Boolean(value));
  const keys = [
    ...identityKeys,
    input.fingerprint ? `fingerprint:${input.fingerprint}` : null,
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(keys));
}

export function getInviteRequestActorKeys(
  request: Request,
  input: { userId?: string | null; email?: string | null } = {},
) {
  return getInviteActorKeys({
    ...input,
    ip: extractClientIp(request),
    fingerprint: request.headers.get(CSRF_REQUEST_HEADER_NAME),
  });
}

export async function reserveInviteCreationAttempt(householdId: string, userId: string) {
  return reserveAtomic([
    reservation(ACTION.creation, [householdId, userId], INVITE_CREATION_LIMIT),
  ]);
}

export type InviteRateLimitOptions = {
  // When the caller has already determined that the token corresponds to a
  // real invite, it may pass the invite's maxUses so the token-wide caps
  // scale with the invite's capacity (callers decide the policy — see
  // inviteCapacityRateLimitOptions in lib/household-invites.ts). Per-actor
  // caps are NOT affected and remain strict. For unknown tokens, omit maxUses
  // — the strict defaults still apply, preserving probing protection against
  // invalid/random tokens.
  acceptableMaxUses?: number | null;
};

export function getInviteLookupTokenLimit(maxUses?: number | null): number {
  if (!maxUses || maxUses <= 0) return INVITE_LOOKUP_TOKEN_LIMIT;
  return Math.max(
    INVITE_LOOKUP_TOKEN_LIMIT,
    maxUses * INVITE_LOOKUP_PER_USE_MULTIPLIER + INVITE_LOOKUP_TOKEN_BUFFER,
  );
}

export function getInviteAcceptanceTokenLimit(maxUses?: number | null): number {
  if (!maxUses || maxUses <= 0) return INVITE_ACCEPTANCE_TOKEN_LIMIT;
  return Math.max(
    INVITE_ACCEPTANCE_TOKEN_LIMIT,
    maxUses + INVITE_ACCEPTANCE_TOKEN_BUFFER,
  );
}

export async function reserveInviteAcceptanceAttempt(
  tokenHash: string,
  actorKeys: string[],
  options: InviteRateLimitOptions = {},
) {
  const tokenLimit = getInviteAcceptanceTokenLimit(options.acceptableMaxUses);
  return reserveAtomic([
    reservation(ACTION.acceptanceToken, [tokenHash], tokenLimit),
    ...actorKeys.flatMap((actorKey) => [
      reservation(ACTION.acceptanceActor, [actorKey], INVITE_ACCEPTANCE_USER_LIMIT),
      reservation(
        ACTION.acceptanceActorToken,
        [actorKey, tokenHash],
        INVITE_ACCEPTANCE_ACTOR_TOKEN_LIMIT,
      ),
    ]),
  ]);
}

export async function reserveInviteLookupAttempt(
  tokenHash: string,
  actorKeys: string[],
  options: InviteRateLimitOptions = {},
) {
  const tokenLimit = getInviteLookupTokenLimit(options.acceptableMaxUses);
  return reserveAtomic([
    reservation(ACTION.lookupToken, [tokenHash], tokenLimit),
    ...actorKeys.map((actorKey) =>
      reservation(ACTION.lookupActor, [actorKey], INVITE_LOOKUP_ACTOR_LIMIT),
    ),
  ]);
}

export async function reserveInviteFailureAudit(input: {
  reason: string;
  userId?: string | null;
  householdId?: string | null;
  tokenHash?: string | null;
  inviteId?: string | null;
}) {
  const tokenScopedFailure = ["not_found", "expired", "revoked", "used_up"].includes(
    input.reason,
  );
  return reserveAtomic([
    reservation(
      ACTION.failureAudit,
      [
        input.reason,
        tokenScopedFailure ? null : input.userId,
        input.householdId,
        input.tokenHash,
        input.inviteId,
      ],
      1,
      AUDIT_THROTTLE_WINDOW_MS,
    ),
  ]);
}

export async function cleanupInviteRateLimitAttempts(
  before = new Date(Date.now() - INVITE_RATE_LIMIT_RETENTION_MS),
) {
  return prisma.inviteRateLimitAttempt.deleteMany({
    where: { createdAt: { lt: before } },
  });
}
