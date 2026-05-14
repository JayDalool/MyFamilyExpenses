import { NextResponse } from "next/server";
import { buildAuthUrl, generatePKCE, generateState, isOAuthEnabled } from "@/lib/auth/oauth";
import { buildInternalUrl } from "@/lib/auth/app-url";
import { setOAuthFlowCookies } from "@/lib/auth/oauth-cookies";

export async function GET(request: Request) {
  if (!isOAuthEnabled("microsoft")) {
    return NextResponse.redirect(buildInternalUrl("/auth/login", request.url));
  }

  const state = generateState();
  const { verifier, challenge } = generatePKCE();
  const authUrl = buildAuthUrl("microsoft", state, challenge);

  const response = NextResponse.redirect(authUrl);
  setOAuthFlowCookies(response, "microsoft", state, verifier);
  return response;
}
