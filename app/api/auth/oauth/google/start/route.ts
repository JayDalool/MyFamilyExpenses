import { NextResponse } from "next/server";
import { buildAuthUrl, generatePKCE, generateState, isOAuthEnabled } from "@/lib/auth/oauth";
import { buildInternalUrl } from "@/lib/auth/app-url";
import { setOAuthFlowCookies } from "@/lib/auth/oauth-cookies";
import { inviteTokenSchema } from "@/lib/validation/household";

export async function GET(request: Request) {
  if (!isOAuthEnabled("google")) {
    return NextResponse.redirect(buildInternalUrl("/auth/login", request.url));
  }

  const state = generateState();
  const { verifier, challenge } = generatePKCE();
  const authUrl = buildAuthUrl("google", state, challenge);
  const inviteTokenResult = inviteTokenSchema.safeParse(
    new URL(request.url).searchParams.get("invite") ?? undefined,
  );

  const response = NextResponse.redirect(authUrl);
  setOAuthFlowCookies(
    response,
    "google",
    state,
    verifier,
    inviteTokenResult.success ? inviteTokenResult.data : null,
  );
  return response;
}
