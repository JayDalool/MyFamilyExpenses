import crypto from "node:crypto";
import { Prisma, type HouseholdInvite, type HouseholdRole } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { AuthContext } from "@/lib/auth/session";
import { canInviteMembers, canInviteRole } from "@/lib/auth/permissions";
import { buildInternalUrl } from "@/lib/auth/app-url";
import { writeAuditLog } from "@/lib/audit";
import {
  type InviteRateLimitOptions,
  reserveInviteAcceptanceAttempt,
  reserveInviteCreationAttempt,
  reserveInviteFailureAudit,
  reserveInviteLookupAttempt,
} from "@/lib/invite-rate-limit";

type InviteDb = Prisma.TransactionClient | typeof prisma;

type InviteWithHousehold = HouseholdInvite & {
  household: { id: string; name: string };
};

export type InviteFailureReason =
  | "not_found"
  | "expired"
  | "revoked"
  | "used_up"
  | "email_mismatch"
  | "duplicate_membership"
  | "inviter_not_authorized"
  | "rate_limited";

export class InviteAcceptanceError extends Error {
  constructor(
    public readonly reason: InviteFailureReason,
    public readonly householdId?: string,
  ) {
    super(`Invite cannot be accepted: ${reason}`);
    this.name = "InviteAcceptanceError";
  }
}

export function createInviteToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashInviteToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function normalizeInviteEmail(email?: string | null) {
  const trimmed = email?.trim().toLowerCase();
  return trimmed || null;
}

export function buildInviteUrl(token: string, fallbackUrl?: string) {
  return buildInternalUrl(`/invite/${encodeURIComponent(token)}`, fallbackUrl).toString();
}

function getInviteExpiry(expiresInDays: number) {
  return new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
}

export async function auditInviteFailure(input: {
  actionUserId?: string | null;
  householdId?: string | null;
  reason: InviteFailureReason;
  tokenHash?: string | null;
  inviteId?: string | null;
  source?: string | null;
}) {
  let reserved = false;
  try {
    reserved = await reserveInviteFailureAudit({
      reason: input.reason,
      userId: input.actionUserId,
      householdId: input.householdId,
      tokenHash: input.tokenHash,
      inviteId: input.inviteId,
    });
  } catch (error) {
    console.error("[audit] failed to reserve invite failure audit:", error);
  }
  if (!reserved) return false;

  return writeAuditLog({
    userId: input.actionUserId ?? null,
    householdId: input.householdId ?? null,
    action:
      input.reason === "expired"
        ? "household.invite.expired"
        : "household.invite.accept_failed",
    metadata: {
      reason: input.reason,
      ...(input.inviteId ? { inviteId: input.inviteId } : {}),
      ...(input.source ? { source: input.source } : {}),
    },
  });
}

export async function createHouseholdInvite(
  auth: AuthContext,
  input: {
    email?: string | null;
    role: Exclude<HouseholdRole, "OWNER">;
    expiresInDays: number;
    maxUses: number;
  },
) {
  if (!canInviteMembers(auth) || !canInviteRole(auth.householdRole, input.role)) {
    throw new InviteAcceptanceError("inviter_not_authorized", auth.householdId);
  }
  if (!(await reserveInviteCreationAttempt(auth.householdId, auth.user.id))) {
    throw new InviteAcceptanceError("rate_limited", auth.householdId);
  }

  const token = createInviteToken();
  const invite = await prisma.householdInvite.create({
    data: {
      householdId: auth.householdId,
      tokenHash: hashInviteToken(token),
      email: normalizeInviteEmail(input.email),
      role: input.role,
      expiresAt: getInviteExpiry(input.expiresInDays),
      maxUses: input.maxUses,
      createdByUserId: auth.user.id,
    },
  });

  await writeAuditLog({
    userId: auth.user.id,
    householdId: auth.householdId,
    action: "household.invite.created",
    metadata: {
      inviteId: invite.id,
      emailRestricted: Boolean(invite.email),
      role: invite.role,
      maxUses: invite.maxUses,
      expiresAt: invite.expiresAt.toISOString(),
    },
  });

  return { invite, token };
}

export async function getInviteSummaryByToken(token: string, db: InviteDb = prisma) {
  const invite = await db.householdInvite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    include: { household: { select: { id: true, name: true } } },
  });

  if (!invite) return null;

  const now = new Date();
  const isAvailable =
    !invite.revokedAt && invite.expiresAt > now && invite.usedCount < invite.maxUses;
  const unavailableReason: "revoked" | "expired" | "used_up" | null = invite.revokedAt
    ? "revoked"
    : invite.expiresAt <= now
      ? "expired"
      : invite.usedCount >= invite.maxUses
        ? "used_up"
        : null;

  return {
    id: invite.id,
    householdId: invite.householdId,
    householdName: invite.household.name,
    role: invite.role,
    emailRestricted: Boolean(invite.email),
    expiresAt: invite.expiresAt,
    usedCount: invite.usedCount,
    maxUses: invite.maxUses,
    isAvailable,
    unavailableReason,
  };
}

export async function requireAcceptableInviteByHash(
  tokenHash: string,
  input: { email: string; userId?: string },
  db: InviteDb = prisma,
) {
  const invite = await db.householdInvite.findUnique({
    where: { tokenHash },
    include: { household: { select: { id: true, name: true } } },
  });

  if (!invite) {
    throw new InviteAcceptanceError("not_found");
  }

  const now = new Date();
  if (invite.revokedAt) {
    throw new InviteAcceptanceError("revoked", invite.householdId);
  }
  if (invite.expiresAt <= now) {
    throw new InviteAcceptanceError("expired", invite.householdId);
  }
  if (invite.usedCount >= invite.maxUses) {
    throw new InviteAcceptanceError("used_up", invite.householdId);
  }
  if (invite.email && invite.email !== input.email.trim().toLowerCase()) {
    throw new InviteAcceptanceError("email_mismatch", invite.householdId);
  }

  const inviterMembership = await db.membership.findFirst({
    where: {
      userId: invite.createdByUserId,
      householdId: invite.householdId,
      removedAt: null,
    },
  });

  if (!inviterMembership || !canInviteRole(inviterMembership.role, invite.role)) {
    throw new InviteAcceptanceError("inviter_not_authorized", invite.householdId);
  }

  const existingMembership = input.userId
    ? await db.membership.findUnique({
        where: {
          userId_householdId: {
            userId: input.userId,
            householdId: invite.householdId,
          },
        },
      })
    : null;

  if (existingMembership && !existingMembership.removedAt) {
    throw new InviteAcceptanceError("duplicate_membership", invite.householdId);
  }

  return { invite, existingMembership };
}

export async function requireAcceptableInviteByToken(
  token: string,
  input: { email: string; userId?: string },
  db: InviteDb = prisma,
) {
  return requireAcceptableInviteByHash(hashInviteToken(token), input, db);
}

export async function reserveInviteLookupOrThrow(
  tokenHash: string,
  actorKeys: string[],
  options: InviteRateLimitOptions = {},
) {
  if (!(await reserveInviteLookupAttempt(tokenHash, actorKeys, options))) {
    throw new InviteAcceptanceError("rate_limited");
  }
}

export async function reserveInviteAcceptanceOrThrow(
  tokenHash: string,
  actorKeys: string[],
  options: InviteRateLimitOptions = {},
) {
  if (!(await reserveInviteAcceptanceAttempt(tokenHash, actorKeys, options))) {
    throw new InviteAcceptanceError("rate_limited");
  }
}

export type InviteCapacityProbe = {
  exists: boolean;
  isAcceptable: boolean;
  maxUses: number;
};

// Lightweight existence + acceptability probe used to compute token-wide rate
// limit budgets. Returns acceptableMaxUses === null when the invite either does
// not exist or cannot currently be accepted, which keeps the strict default
// caps in effect against invalid-token probing.
export async function probeInviteCapacityByHash(
  tokenHash: string,
  db: InviteDb = prisma,
): Promise<InviteCapacityProbe> {
  const invite = await db.householdInvite.findUnique({
    where: { tokenHash },
    select: {
      maxUses: true,
      usedCount: true,
      expiresAt: true,
      revokedAt: true,
    },
  });
  if (!invite) {
    return { exists: false, isAcceptable: false, maxUses: 0 };
  }
  const now = new Date();
  const isAcceptable =
    !invite.revokedAt && invite.expiresAt > now && invite.usedCount < invite.maxUses;
  return { exists: true, isAcceptable, maxUses: invite.maxUses };
}

export async function probeInviteCapacityByToken(
  token: string,
  db: InviteDb = prisma,
): Promise<InviteCapacityProbe> {
  return probeInviteCapacityByHash(hashInviteToken(token), db);
}

export function inviteCapacityRateLimitOptions(
  capacity: InviteCapacityProbe | null,
): InviteRateLimitOptions {
  // Scale token-wide caps whenever the token matches a real invite, even if
  // currently revoked/expired/used-up. Probing only applies to tokens that do
  // not correspond to any invite; for those the strict default caps still
  // bite. Once the token is known to exist, the bigger budget avoids a race
  // between "rate-limited because too many lookups" and "rejected because
  // used_up" on the boundary call.
  return {
    acceptableMaxUses: capacity?.exists ? capacity.maxUses : null,
  };
}

export async function consumeInviteUse(
  invite: Pick<HouseholdInvite, "id">,
  db: InviteDb = prisma,
) {
  const updated = await db.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      UPDATE "household_invites"
      SET
        "used_count" = "used_count" + 1,
        "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = CAST(${invite.id} AS uuid)
        AND "revoked_at" IS NULL
        AND "expires_at" > CURRENT_TIMESTAMP
        AND "used_count" < "max_uses"
      RETURNING "id"
    `,
  );

  if (updated.length !== 1) {
    throw new InviteAcceptanceError("used_up");
  }
}

export async function acceptHouseholdInviteForUser(
  token: string,
  user: { id: string; email: string },
  actorKeys: string[] = [`user:${user.id}`],
) {
  const tokenHash = hashInviteToken(token);
  const capacity = await probeInviteCapacityByHash(tokenHash);
  const rateLimitOptions = inviteCapacityRateLimitOptions(capacity);
  if (!(await reserveInviteLookupAttempt(tokenHash, actorKeys, rateLimitOptions))) {
    await auditInviteFailure({
      actionUserId: user.id,
      reason: "rate_limited",
      tokenHash,
      source: "invite_lookup",
    });
    return { ok: false as const, reason: "rate_limited" as const };
  }
  try {
    await reserveInviteAcceptanceOrThrow(tokenHash, actorKeys, rateLimitOptions);
  } catch (error) {
    if (!(error instanceof InviteAcceptanceError)) throw error;
    await auditInviteFailure({
      actionUserId: user.id,
      reason: "rate_limited",
      tokenHash,
      source: "invite_acceptance",
    });
    return { ok: false as const, reason: "rate_limited" as const };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const { invite, existingMembership } = await requireAcceptableInviteByToken(
        token,
        { userId: user.id, email: user.email },
        tx,
      );
      await consumeInviteUse(invite, tx);

      const membership = existingMembership
        ? await tx.membership.update({
            where: { id: existingMembership.id },
            data: { role: invite.role, removedAt: null },
          })
        : await tx.membership.create({
            data: {
              userId: user.id,
              householdId: invite.householdId,
              role: invite.role,
            },
          });

      return { invite: invite as InviteWithHousehold, membership };
    });

    await writeAuditLog({
      userId: user.id,
      householdId: result.invite.householdId,
      action: "household.invite.accepted",
      metadata: {
        inviteId: result.invite.id,
        role: result.membership.role,
      },
    });

    return {
      ok: true as const,
      householdId: result.invite.householdId,
      householdName: result.invite.household.name,
      role: result.membership.role,
    };
  } catch (error) {
    if (error instanceof InviteAcceptanceError) {
      await auditInviteFailure({
        actionUserId: user.id,
        householdId: error.householdId,
        reason: error.reason,
        tokenHash,
      });
      return { ok: false as const, reason: error.reason, householdId: error.householdId };
    }

    throw error;
  }
}

export async function revokeHouseholdInvite(auth: AuthContext, inviteId: string) {
  if (!canInviteMembers(auth)) {
    throw new InviteAcceptanceError("inviter_not_authorized", auth.householdId);
  }

  const invite = await prisma.householdInvite.findFirst({
    where: { id: inviteId, householdId: auth.householdId },
  });

  if (!invite) return null;
  if (auth.householdRole !== "OWNER" && !canInviteRole(auth.householdRole, invite.role)) {
    throw new InviteAcceptanceError("inviter_not_authorized", auth.householdId);
  }

  const updated = await prisma.householdInvite.update({
    where: { id: invite.id },
    data: { revokedAt: invite.revokedAt ?? new Date() },
  });

  await writeAuditLog({
    userId: auth.user.id,
    householdId: auth.householdId,
    action: "household.invite.revoked",
    metadata: { inviteId: invite.id, role: invite.role },
  });

  return updated;
}
