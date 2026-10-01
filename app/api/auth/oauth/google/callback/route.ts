import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { createSession, setActiveHouseholdCookie } from "@/lib/auth/session";
import { onboardNewUserInTransaction } from "@/lib/auth/onboarding";
import { buildInternalUrl } from "@/lib/auth/app-url";
import {
  exchangeCode,
  fetchUserInfo,
  isOAuthEnabled,
  OAuthUnverifiedEmailError,
} from "@/lib/auth/oauth";
import { clearOAuthFlowCookies, getOAuthCookieNames } from "@/lib/auth/oauth-cookies";
import { writeAuditLog } from "@/lib/audit";
import {
  acceptHouseholdInviteForUser,
  auditInviteFailure,
  consumeInviteUse,
  hashInviteToken,
  inviteCapacityRateLimitOptions,
  InviteAcceptanceError,
  probeInviteCapacityByHash,
  requireAcceptableInviteByToken,
  reserveInviteAcceptanceOrThrow,
  reserveInviteLookupOrThrow,
} from "@/lib/household-invites";
import { getInviteRequestActorKeys } from "@/lib/invite-rate-limit";

function errRedirect(requestUrl: string, code: string): NextResponse {
  const response = NextResponse.redirect(buildInternalUrl(`/auth/login?error=${code}`, requestUrl));
  clearOAuthFlowCookies(response, "google");
  return response;
}

function redirectAfterInvite(
  requestUrl: string,
  inviteToken: string | undefined,
  inviteHandled: boolean,
) {
  return buildInternalUrl(
    inviteToken && !inviteHandled ? `/invite/${encodeURIComponent(inviteToken)}` : "/dashboard",
    requestUrl,
  );
}

export async function GET(request: Request) {
  if (!isOAuthEnabled("google")) {
    return errRedirect(request.url, "oauth_disabled");
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) return errRedirect(request.url, "oauth_denied");
  if (!code || !stateParam) return errRedirect(request.url, "oauth_invalid");

  const cookieStore = await cookies();
  const cookieNames = getOAuthCookieNames("google");
  const storedState = cookieStore.get(cookieNames.state)?.value;
  const storedVerifier = cookieStore.get(cookieNames.verifier)?.value;
  const storedInviteToken = cookieStore.get(cookieNames.invite)?.value;

  if (!storedState || !storedVerifier || stateParam !== storedState) {
    return errRedirect(request.url, "oauth_state_mismatch");
  }

  let userInfo;
  try {
    const tokens = await exchangeCode("google", code, storedVerifier);
    userInfo = await fetchUserInfo("google", tokens.access_token);
  } catch (err) {
    if (err instanceof OAuthUnverifiedEmailError) {
      return errRedirect(request.url, "oauth_unverified_email");
    }
    console.error("[oauth/google] callback error:", err);
    return errRedirect(request.url, "oauth_error");
  }

  const existingAccount = await prisma.authAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider: "GOOGLE",
        providerAccountId: userInfo.providerAccountId,
      },
    },
  });
  const inviteActorKeys = getInviteRequestActorKeys(request, {
    userId: existingAccount?.userId,
    email: userInfo.email,
  });
  const storedInviteTokenHash = storedInviteToken
    ? hashInviteToken(storedInviteToken)
    : null;

  if (existingAccount) {
    await createSession(existingAccount.userId);
    const inviteAcceptance = storedInviteToken
      ? await acceptHouseholdInviteForUser(storedInviteToken, {
          id: existingAccount.userId,
          email: userInfo.email,
        }, inviteActorKeys)
      : null;

    const acceptedHouseholdId = inviteAcceptance?.ok
      ? inviteAcceptance.householdId
      : inviteAcceptance?.reason === "duplicate_membership"
        ? inviteAcceptance.householdId
        : null;
    if (acceptedHouseholdId) {
      await setActiveHouseholdCookie(acceptedHouseholdId);
    }

    const membership = await prisma.membership.findFirst({
      where: { userId: existingAccount.userId, removedAt: null },
      orderBy: { createdAt: "asc" },
    });
    await writeAuditLog({
      userId: existingAccount.userId,
      householdId: membership?.householdId ?? null,
      action: "auth.login.oauth",
      metadata: { provider: "GOOGLE", email: userInfo.email },
    });

    const inviteHandled =
      inviteAcceptance?.ok || inviteAcceptance?.reason === "duplicate_membership";
    const response = NextResponse.redirect(
      membership
        ? redirectAfterInvite(request.url, storedInviteToken, Boolean(inviteHandled))
        : buildInternalUrl("/no-household", request.url),
    );
    clearOAuthFlowCookies(response, "google");
    return response;
  }

  const existingUser = await prisma.user.findUnique({ where: { email: userInfo.email } });
  if (existingUser) return errRedirect(request.url, "oauth_email_exists");

  try {
    if (storedInviteTokenHash) {
      const capacity = await probeInviteCapacityByHash(storedInviteTokenHash);
      const rateLimitOptions = inviteCapacityRateLimitOptions(capacity);
      await reserveInviteLookupOrThrow(
        storedInviteTokenHash,
        inviteActorKeys,
        rateLimitOptions,
      );
      await reserveInviteAcceptanceOrThrow(
        storedInviteTokenHash,
        inviteActorKeys,
        rateLimitOptions,
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const invite = storedInviteToken
        ? await requireAcceptableInviteByToken(
            storedInviteToken,
            { email: userInfo.email },
            tx,
          )
        : null;

      if (invite) {
        await consumeInviteUse(invite.invite, tx);
      }

      const newUser = await onboardNewUserInTransaction(tx, {
        name: userInfo.name,
        email: userInfo.email,
        imageUrl: userInfo.imageUrl,
        emailVerifiedAt: userInfo.emailVerified ? new Date() : null,
        oauthAccount: {
          provider: "GOOGLE",
          providerAccountId: userInfo.providerAccountId,
          providerEmail: userInfo.email,
        },
        ...(invite
          ? {
              initialMembership: {
                householdId: invite.invite.householdId,
                role: invite.invite.role as "ADMIN" | "MEMBER" | "VIEWER",
              },
            }
          : {}),
      });

      return { newUser, inviteId: invite?.invite.id ?? null };
    });

    const { newUser, inviteId } = result;
    await createSession(newUser.id);
    await setActiveHouseholdCookie(newUser.householdId);
    await writeAuditLog({
      userId: newUser.id,
      householdId: newUser.householdId,
      action: "auth.signup.oauth",
      metadata: { provider: "GOOGLE", email: userInfo.email },
    });
    if (inviteId) {
      await writeAuditLog({
        userId: newUser.id,
        householdId: newUser.householdId,
        action: "household.invite.accepted",
        metadata: { provider: "GOOGLE", inviteId },
      });
    }

    const response = NextResponse.redirect(buildInternalUrl("/dashboard", request.url));
    clearOAuthFlowCookies(response, "google");
    return response;
  } catch (err) {
    if (err instanceof InviteAcceptanceError) {
      await auditInviteFailure({
        householdId: err.householdId,
        reason: err.reason,
        tokenHash: storedInviteTokenHash,
        source: "oauth_google",
      });
      const response = NextResponse.redirect(
        buildInternalUrl(
          storedInviteToken
            ? `/invite/${encodeURIComponent(storedInviteToken)}`
            : "/auth/login?error=invite_invalid",
          request.url,
        ),
      );
      clearOAuthFlowCookies(response, "google");
      return response;
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return errRedirect(request.url, "oauth_email_exists");
    }
    console.error("[oauth/google] onboard error:", err);
    return errRedirect(request.url, "oauth_error");
  }
}
