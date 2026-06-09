import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createSession, setActiveHouseholdCookie } from "@/lib/auth/session";
import { buildInternalUrl } from "@/lib/auth/app-url";
import { hashSignupVerificationToken } from "@/lib/auth/signup-verification";
import { onboardNewUserInTransaction } from "@/lib/auth/onboarding";
import { writeAuditLog } from "@/lib/audit";
import {
  auditInviteFailure,
  consumeInviteUse,
  inviteCapacityRateLimitOptions,
  InviteAcceptanceError,
  probeInviteCapacityByHash,
  requireAcceptableInviteByHash,
  reserveInviteAcceptanceOrThrow,
  reserveInviteLookupOrThrow,
} from "@/lib/household-invites";
import { getInviteRequestActorKeys } from "@/lib/invite-rate-limit";

function redirectWithCode(requestUrl: string, code: string) {
  return NextResponse.redirect(buildInternalUrl(`/auth/login?error=${code}`, requestUrl));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token")?.trim();

  if (!token) {
    return redirectWithCode(request.url, "signup_verification_invalid");
  }

  const tokenHash = hashSignupVerificationToken(token);
  const pendingSignup = await prisma.pendingSignup.findUnique({
    where: { verificationTokenHash: tokenHash },
  });

  if (!pendingSignup) {
    return redirectWithCode(request.url, "signup_verification_invalid");
  }

  if (pendingSignup.expiresAt <= new Date()) {
    await prisma.pendingSignup.deleteMany({
      where: { id: pendingSignup.id },
    });

    return redirectWithCode(request.url, "signup_verification_expired");
  }

  try {
    if (pendingSignup.inviteTokenHash) {
      const actorKeys = getInviteRequestActorKeys(request, {
        email: pendingSignup.email,
      });
      const capacity = await probeInviteCapacityByHash(
        pendingSignup.inviteTokenHash,
      );
      const rateLimitOptions = inviteCapacityRateLimitOptions(capacity);
      await reserveInviteLookupOrThrow(
        pendingSignup.inviteTokenHash,
        actorKeys,
        rateLimitOptions,
      );
      await reserveInviteAcceptanceOrThrow(
        pendingSignup.inviteTokenHash,
        actorKeys,
        rateLimitOptions,
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: { email: pendingSignup.email },
      });

      if (existingUser) {
        await tx.pendingSignup.delete({
          where: { id: pendingSignup.id },
        });

        return null;
      }

      const invite = pendingSignup.inviteTokenHash
        ? await requireAcceptableInviteByHash(
            pendingSignup.inviteTokenHash,
            { email: pendingSignup.email },
            tx,
          )
        : null;

      if (invite) {
        await consumeInviteUse(invite.invite, tx);
      }

      const onboardedUser = await onboardNewUserInTransaction(tx, {
        name: pendingSignup.name,
        email: pendingSignup.email,
        passwordHash: pendingSignup.passwordHash,
        emailVerifiedAt: new Date(),
        ...(invite
          ? {
              initialMembership: {
                householdId: invite.invite.householdId,
                role: invite.invite.role as "ADMIN" | "MEMBER" | "VIEWER",
              },
            }
          : {}),
      });

      await tx.pendingSignup.delete({
        where: { id: pendingSignup.id },
      });

      return { user: onboardedUser, inviteId: invite?.invite.id ?? null };
    });

    if (!result) {
      return redirectWithCode(request.url, "signup_email_exists");
    }

    const { user, inviteId } = result;
    await createSession(user.id);
    await setActiveHouseholdCookie(user.householdId);
    await writeAuditLog({
      userId: user.id,
      householdId: user.householdId,
      action: "auth.signup.verified",
      metadata: { email: user.email },
    });
    if (inviteId) {
      await writeAuditLog({
        userId: user.id,
        householdId: user.householdId,
        action: "household.invite.accepted",
        metadata: { inviteId, source: "signup_verification" },
      });
    }

    return NextResponse.redirect(buildInternalUrl("/dashboard", request.url));
  } catch (error) {
    if (error instanceof InviteAcceptanceError) {
      await auditInviteFailure({
        householdId: error.householdId,
        reason: error.reason,
        tokenHash: pendingSignup.inviteTokenHash,
        source: "signup_verification",
      });
      return redirectWithCode(request.url, "invite_invalid");
    }
    console.error("[signup/verify] verification error:", error);
    return redirectWithCode(request.url, "signup_verification_invalid");
  }
}
