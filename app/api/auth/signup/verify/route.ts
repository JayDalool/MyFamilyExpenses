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
import { workspaceReportsHref } from "@/lib/report-links";

function redirectTo(request: Request, pathname: string) {
  return NextResponse.redirect(
    buildInternalUrl(pathname, request.url),
    request.method === "POST" ? 303 : 307,
  );
}

export async function GET(request: Request) {
  return verifySignup(request, new URL(request.url).searchParams.get("token")?.trim());
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const token = form?.get("token");
  return verifySignup(request, typeof token === "string" ? token.trim() : undefined);
}

async function verifySignup(request: Request, token?: string) {
  const fail = (code: string) => redirectTo(request, `/auth/login?error=${code}`);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) {
    return fail("signup_verification_invalid");
  }

  const tokenHash = hashSignupVerificationToken(token);
  const pendingSignup = await prisma.pendingSignup.findUnique({
    where: { verificationTokenHash: tokenHash },
  });

  if (!pendingSignup) {
    return fail("signup_verification_invalid");
  }

  if (pendingSignup.expiresAt <= new Date()) {
    await prisma.pendingSignup.deleteMany({
      where: { id: pendingSignup.id, verificationTokenHash: tokenHash },
    });

    return fail("signup_verification_expired");
  }

  try {
    if (pendingSignup.inviteTokenHash) {
      if (request.method === "GET") {
        const invite = await prisma.householdInvite.findUnique({
          where: { tokenHash: pendingSignup.inviteTokenHash },
          select: { role: true },
        });
        if (invite?.role === "ACCOUNTANT") {
          return redirectTo(request, `/auth/verify-accountant?token=${encodeURIComponent(token)}`);
        }
      }
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
      const claim = await tx.pendingSignup.deleteMany({
        where: {
          id: pendingSignup.id,
          verificationTokenHash: tokenHash,
          expiresAt: { gt: new Date() },
        },
      });
      if (claim.count === 0) return { error: "signup_verification_invalid" } as const;

      const existingUser = await tx.user.findUnique({
        where: { email: pendingSignup.email },
      });

      if (existingUser) return { error: "signup_email_exists" } as const;

      const invite = pendingSignup.inviteTokenHash
        ? await requireAcceptableInviteByHash(
            pendingSignup.inviteTokenHash,
            { email: pendingSignup.email },
            tx,
          )
        : null;

      if (invite) {
        await consumeInviteUse(invite.invite, tx, pendingSignup.email);
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
                role: invite.invite.role as "ADMIN" | "MEMBER" | "ACCOUNTANT" | "VIEWER",
              },
            }
          : {}),
      });

      return { user: onboardedUser, invite: invite?.invite ?? null };
    });

    if ("error" in result && result.error) return fail(result.error);

    const { user, invite } = result;
    await createSession(user.id);
    await setActiveHouseholdCookie(user.householdId);
    await writeAuditLog({
      userId: user.id,
      householdId: user.householdId,
      action: "auth.signup.verified",
      metadata: { email: user.email },
    });
    if (invite) {
      await writeAuditLog({
        userId: user.id,
        householdId: user.householdId,
        action: "household.invite.accepted",
        metadata: { inviteId: invite.id, source: "signup_verification" },
      });
    }

    return redirectTo(request, invite?.role === "ACCOUNTANT" ? workspaceReportsHref(user.householdId) : "/dashboard");
  } catch (error) {
    if (error instanceof InviteAcceptanceError) {
      await auditInviteFailure({
        householdId: error.householdId,
        reason: error.reason,
        tokenHash: pendingSignup.inviteTokenHash,
        source: "signup_verification",
      });
      return fail("invite_invalid");
    }
    console.error("[signup/verify] verification error:", error);
    return fail("signup_verification_invalid");
  }
}
