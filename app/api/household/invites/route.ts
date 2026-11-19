import { NextResponse } from "next/server";
import { getCurrentHousehold } from "@/lib/auth/session";
import { canInviteMembers } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { getAppBaseUrl } from "@/lib/auth/app-url";
import { canSendSmtpEmail } from "@/lib/email";
import {
  buildInviteUrl,
  createHouseholdInvite,
  deliverAccountantInvite,
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
      emailStatus: true,
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

  const accountant = parsed.data.role === "ACCOUNTANT";
  let inviteBaseUrl = request.url;
  if (accountant) {
    if (!canInviteMembers(auth)) {
      return NextResponse.json({ error: { message: "Invite access required." } }, { status: 403 });
    }
    if (parsed.data.householdId !== auth.householdId) {
      return NextResponse.json(
        { error: { message: "The active workspace changed. Reopen the workspace before sending." } },
        { status: 409 },
      );
    }
    try {
      inviteBaseUrl = getAppBaseUrl();
    } catch {
      return NextResponse.json(
        { error: { message: "Configure the app’s public URL before sending accountant invitations." } },
        { status: 503 },
      );
    }
    if (!canSendSmtpEmail()) {
      return NextResponse.json(
        { error: { message: "Email delivery is unavailable. Ask the app administrator to configure SMTP." } },
        { status: 503 },
      );
    }
  }

  try {
    // TODO: enforce plan-based member and invite limits here when entitlements exist.
    const { invite, token } = await createHouseholdInvite(auth, parsed.data);
    const inviteUrl = buildInviteUrl(token, inviteBaseUrl);
    if (accountant) {
      const emailStatus = await deliverAccountantInvite(auth, invite, inviteUrl);
      if (emailStatus !== "SENT") {
        return NextResponse.json(
          { error: { message: emailStatus === "FAILED"
            ? "The invitation email could not be sent. Try resending it."
            : "The invitation was revoked before delivery finished." } },
          { status: emailStatus === "FAILED" ? 502 : 409 },
        );
      }
      return NextResponse.json({ data: { emailStatus } }, { status: 201 });
    }
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
          inviteUrl,
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
      if (error.reason === "duplicate_membership" || error.reason === "email_in_progress") {
        return NextResponse.json(
          { error: { message: error.reason === "duplicate_membership"
            ? "This email already has access. A workspace owner can change their role in Members."
            : "An invitation is already being sent to this email." } },
          { status: 409 },
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
