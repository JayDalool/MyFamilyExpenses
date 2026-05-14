import { prisma } from "@/lib/db/prisma";

/**
 * Creates a default household + OWNER membership for a user who has none.
 * Called only when ALLOW_LOGIN_HOUSEHOLD_BOOTSTRAP=true in env.
 *
 * Safe to call multiple times (returns existing householdId if already present).
 */
export async function ensureUserHousehold(userId: string, userName: string): Promise<string> {
  const existing = await prisma.membership.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing.householdId;

  const household = await prisma.household.create({
    data: {
      name: `${userName}'s Household`,
      memberships: {
        create: { userId, role: "OWNER" },
      },
    },
  });

  return household.id;
}
