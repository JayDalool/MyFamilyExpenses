import { NextResponse } from "next/server";
import { getCurrentHousehold } from "@/lib/auth/session";
import { canInviteMembers } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import {
  buildInviteUrl,
  createHouseholdInvite,
  InviteAcceptanceError,
} from "@/lib/household-invites";
import { createHouseholdInviteSchema } from "@/lib/validation/household";

export async function GET() {
  const auth = await getCurrentHousehold();
  if (!auth) {
    return NextResponse.json({ error: { message: "Authentication required." } }, { status: 401 });
  }
  if (!canInviteMembers(auth)) {
    return NextResponse.json({ error: { message: "Invite access required." } }, { status: 403 });
  }

  const invites = await prisma.householdInvite.findMany({
    where: { householdId: auth.householdId, revokedAt: null },
    select: {
      id: true,
      email: true,
      role: true,
      maxUses: true,
      usedCount: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ data: invites });
}

export async function POST(request: Request) {
  const auth = await getCurrentHousehold();
  if (!auth) {
    return NextResponse.json({ error: { message: "Authentication required." } }, { status: 401 });
  }

  const parsed = createHouseholdInviteSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: parsed.error.issues[0]?.message ?? "Invalid invite." } },
      { status: 400 },
    );
  }

  try {
    // TODO: enforce plan-based member and invite limits here when entitlements exist.
    const { invite, token } = await createHouseholdInvite(auth, parsed.data);
    return NextResponse.json(
      {
        data: {
          invite: {
            id: invite.id,
            email: invite.email,
            role: invite.role,
            maxUses: invite.maxUses,
            usedCount: invite.usedCount,
            expiresAt: invite.expiresAt,
          },
          inviteUrl: buildInviteUrl(token, request.url),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof InviteAcceptanceError) {
      if (error.reason === "rate_limited") {
        return NextResponse.json(
          { error: { message: "Too many invite creation attempts. Please try again later." } },
          { status: 429 },
        );
      }
      return NextResponse.json(
        { error: { message: "Your household role cannot create this invite." } },
        { status: 403 },
      );
    }
    throw error;
  }
}
