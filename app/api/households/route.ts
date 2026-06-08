import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import {
  ACTIVE_HOUSEHOLD_COOKIE_NAME,
  getCurrentUser,
} from "@/lib/auth/session";
import { shouldUseSecureCookies } from "@/lib/auth/cookies";
import { writeAuditLog } from "@/lib/audit";

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

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { error: { message: "Authentication required." } },
      { status: 401 },
    );
  }

  const payload = (await request.json().catch(() => null)) as
    | { householdId?: unknown }
    | null;
  const householdId = typeof payload?.householdId === "string" ? payload.householdId : "";
  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, householdId },
    include: { household: { select: { name: true } } },
  });

  if (!membership) {
    return NextResponse.json(
      { error: { message: "Household not found." } },
      { status: 404 },
    );
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_HOUSEHOLD_COOKIE_NAME, membership.householdId, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  await writeAuditLog({
    userId: user.id,
    householdId: membership.householdId,
    action: "household.switch",
    metadata: { householdName: membership.household.name },
  });

  return NextResponse.json({
    data: {
      householdId: membership.householdId,
      householdName: membership.household.name,
      role: membership.role,
    },
  });
}
