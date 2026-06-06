import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { createSession } from "@/lib/auth/session";
import { onboardNewUser } from "@/lib/auth/onboarding";
import { buildInternalUrl } from "@/lib/auth/app-url";
import {
  exchangeCode,
  fetchUserInfo,
  isOAuthEnabled,
  OAuthUnverifiedEmailError,
} from "@/lib/auth/oauth";
import { clearOAuthFlowCookies, getOAuthCookieNames } from "@/lib/auth/oauth-cookies";
import { writeAuditLog } from "@/lib/audit";

function errRedirect(requestUrl: string, code: string): NextResponse {
  const response = NextResponse.redirect(buildInternalUrl(`/auth/login?error=${code}`, requestUrl));
  clearOAuthFlowCookies(response, "microsoft");
  return response;
}

export async function GET(request: Request) {
  if (!isOAuthEnabled("microsoft")) {
    return errRedirect(request.url, "oauth_disabled");
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) return errRedirect(request.url, "oauth_denied");
  if (!code || !stateParam) return errRedirect(request.url, "oauth_invalid");

  const cookieStore = await cookies();
  const cookieNames = getOAuthCookieNames("microsoft");
  const storedState = cookieStore.get(cookieNames.state)?.value;
  const storedVerifier = cookieStore.get(cookieNames.verifier)?.value;

  if (!storedState || !storedVerifier || stateParam !== storedState) {
    return errRedirect(request.url, "oauth_state_mismatch");
  }

  let userInfo;
  try {
    const tokens = await exchangeCode("microsoft", code, storedVerifier);
    userInfo = await fetchUserInfo("microsoft", tokens.access_token);
  } catch (err) {
    if (err instanceof OAuthUnverifiedEmailError)
      return errRedirect(request.url, "oauth_unverified_email");
    console.error("[oauth/microsoft] callback error:", err);
    return errRedirect(request.url, "oauth_error");
  }

  // Existing OAuth account → sign in
  const existingAccount = await prisma.authAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider: "MICROSOFT",
        providerAccountId: userInfo.providerAccountId,
      },
    },
  });
  if (existingAccount) {
    await createSession(existingAccount.userId);
    const membership = await prisma.membership.findFirst({
      where: { userId: existingAccount.userId },
      orderBy: { createdAt: "asc" },
    });
    await writeAuditLog({
      userId: existingAccount.userId,
      householdId: membership?.householdId ?? null,
      action: "auth.login.oauth",
      metadata: { provider: "MICROSOFT", email: userInfo.email },
    });
    const response = NextResponse.redirect(buildInternalUrl("/dashboard", request.url));
    clearOAuthFlowCookies(response, "microsoft");
    return response;
  }

  // Email belongs to a password account → reject auto-linking
  const existingUser = await prisma.user.findUnique({ where: { email: userInfo.email } });
  if (existingUser) return errRedirect(request.url, "oauth_email_exists");

  // New user → onboard
  try {
    const newUser = await onboardNewUser({
      name: userInfo.name,
      email: userInfo.email,
      imageUrl: userInfo.imageUrl,
      emailVerifiedAt: userInfo.emailVerified ? new Date() : null,
      oauthAccount: {
        provider: "MICROSOFT",
        providerAccountId: userInfo.providerAccountId,
        providerEmail: userInfo.email,
      },
    });
    await createSession(newUser.id);
    await writeAuditLog({
      userId: newUser.id,
      householdId: newUser.householdId,
      action: "auth.signup.oauth",
      metadata: { provider: "MICROSOFT", email: userInfo.email },
    });
    const response = NextResponse.redirect(buildInternalUrl("/dashboard", request.url));
    clearOAuthFlowCookies(response, "microsoft");
    return response;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return errRedirect(request.url, "oauth_email_exists");
    }
    console.error("[oauth/microsoft] onboard error:", err);
    return errRedirect(request.url, "oauth_error");
  }
}
