import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/auth/session";

// Lists the authenticated user's household memberships.
// Useful for debugging tenant context and for a future household switcher.
export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { error: { message: "Authentication required." } },
      { status: 401 },
    );
  }

  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    include: { household: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    data: memberships.map((m) => ({
      householdId: m.householdId,
      householdName: m.household.name,
      role: m.role,
      joinedAt: m.createdAt,
    })),
  });
}
