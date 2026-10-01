import { prisma } from "@/lib/db/prisma";

// One user may own this many COMPANY households. Creating a company also writes a
// full default category set, so the route needs a ceiling: without one an
// authenticated user can grow the database without bound. Raise it if a real
// operator needs more.
export const MAX_OWNED_COMPANIES = 5;

export function countOwnedCompanies(userId: string) {
  return prisma.membership.count({
    where: {
      userId,
      role: "OWNER",
      removedAt: null,
      household: { kind: "COMPANY" },
    },
  });
}

export async function hasReachedCompanyLimit(userId: string) {
  return (await countOwnedCompanies(userId)) >= MAX_OWNED_COMPANIES;
}
