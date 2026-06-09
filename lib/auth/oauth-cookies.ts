import type { NextResponse } from "next/server";
import type { OAuthProvider } from "@/lib/auth/oauth";
import { shouldUseSecureCookies } from "@/lib/auth/cookies";

const COOKIE_MAX_AGE = 60 * 10; // 10 minutes

function cookieOptions(maxAge = COOKIE_MAX_AGE) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: shouldUseSecureCookies(),
    path: "/",
    maxAge,
  };
}

export function getOAuthCookieNames(provider: OAuthProvider) {
  return {
    state: `mfe_oauth_${provider}_state`,
    verifier: `mfe_oauth_${provider}_verifier`,
    invite: `mfe_oauth_${provider}_invite`,
  };
}

export function setOAuthFlowCookies(
  response: NextResponse,
  provider: OAuthProvider,
  state: string,
  verifier: string,
  inviteToken?: string | null,
) {
  const names = getOAuthCookieNames(provider);
  const options = cookieOptions();

  response.cookies.set(names.state, state, options);
  response.cookies.set(names.verifier, verifier, options);
  if (inviteToken) {
    response.cookies.set(names.invite, inviteToken, options);
  } else {
    response.cookies.set(names.invite, "", cookieOptions(0));
  }
}

export function clearOAuthFlowCookies(response: NextResponse, provider: OAuthProvider) {
  const names = getOAuthCookieNames(provider);
  const options = cookieOptions(0);

  response.cookies.set(names.state, "", options);
  response.cookies.set(names.verifier, "", options);
  response.cookies.set(names.invite, "", options);
}
