import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

type AuditMetadata = Prisma.InputJsonValue;

type AuditLogInput = {
  userId?: string | null;
  householdId?: string | null;
  action: string;
  metadata?: AuditMetadata;
};

type AuditStore = Pick<typeof prisma, "auditLog">;

export async function writeAuditLog(
  {
    userId,
    householdId,
    action,
    metadata = {},
  }: AuditLogInput,
  db: AuditStore = prisma,
) {
  try {
    await db.auditLog.create({
      data: {
        userId: userId ?? null,
        householdId: householdId ?? null,
        action,
        metadata,
      },
    });
    return true;
  } catch (error) {
    console.error("[audit] failed to write audit log:", error);
    return false;
  }
}
