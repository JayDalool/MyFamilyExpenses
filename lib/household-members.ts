import { Prisma, type HouseholdRole } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { AuthContext } from "@/lib/auth/session";
import { canManageMembers } from "@/lib/auth/permissions";
import { writeAuditLog } from "@/lib/audit";

export class HouseholdMemberError extends Error {
  constructor(
    message: string,
    public readonly code: "forbidden" | "not_found" | "last_owner",
  ) {
    super(message);
    this.name = "HouseholdMemberError";
  }
}

async function lockHouseholdOwnerMutations(
  tx: Prisma.TransactionClient,
  householdId: string,
) {
  await tx.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${"household-owner:" + householdId}))::text`,
  );
}

export async function changeHouseholdMemberRole(
  auth: AuthContext,
  membershipId: string,
  role: HouseholdRole,
) {
  if (!canManageMembers(auth)) {
    throw new HouseholdMemberError("Owner access required.", "forbidden");
  }

  const result = await prisma.$transaction(async (tx) => {
    await lockHouseholdOwnerMutations(tx, auth.householdId);
    const membership = await tx.membership.findFirst({
      where: { id: membershipId, householdId: auth.householdId, removedAt: null },
      include: { user: { select: { email: true } } },
    });
    if (!membership) {
      throw new HouseholdMemberError("Member not found.", "not_found");
    }

    if (membership.role === "OWNER" && role !== "OWNER") {
      const ownerCount = await tx.membership.count({
        where: { householdId: auth.householdId, role: "OWNER", removedAt: null },
      });
      if (ownerCount <= 1) {
        throw new HouseholdMemberError(
          "Assign another owner before changing the only owner's role.",
          "last_owner",
        );
      }
    }

    return tx.membership.update({
      where: { id: membership.id },
      data: { role },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  }, { maxWait: 10_000, timeout: 10_000 });

  await writeAuditLog({
    userId: auth.user.id,
    householdId: auth.householdId,
    action: "household.member.role_changed",
    metadata: { membershipId, userId: result.userId, role },
  });

  return result;
}

export async function removeHouseholdMember(auth: AuthContext, membershipId: string) {
  if (!canManageMembers(auth)) {
    throw new HouseholdMemberError("Owner access required.", "forbidden");
  }

  const result = await prisma.$transaction(async (tx) => {
    await lockHouseholdOwnerMutations(tx, auth.householdId);
    const membership = await tx.membership.findFirst({
      where: { id: membershipId, householdId: auth.householdId, removedAt: null },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!membership) {
      throw new HouseholdMemberError("Member not found.", "not_found");
    }

    if (membership.role === "OWNER") {
      const ownerCount = await tx.membership.count({
        where: { householdId: auth.householdId, role: "OWNER", removedAt: null },
      });
      if (ownerCount <= 1) {
        throw new HouseholdMemberError(
          "The only owner cannot be removed.",
          "last_owner",
        );
      }
    }

    return tx.membership.update({
      where: { id: membership.id },
      data: { removedAt: new Date() },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  }, { maxWait: 10_000, timeout: 10_000 });

  await writeAuditLog({
    userId: auth.user.id,
    householdId: auth.householdId,
    action: "household.member.removed",
    metadata: { membershipId, userId: result.userId, previousRole: result.role },
  });

  return result;
}
