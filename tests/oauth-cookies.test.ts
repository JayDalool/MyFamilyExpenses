import assert from "node:assert/strict";
import test from "node:test";
import type { NextResponse } from "next/server";
import {
  getOAuthCookieNames,
  setOAuthFlowCookies,
} from "../lib/auth/oauth-cookies";
import type { OAuthProvider } from "../lib/auth/oauth";

type CookieWrite = {
  name: string;
  value: string;
  options: { httpOnly?: boolean; maxAge?: number };
};

function createResponseRecorder() {
  const writes: CookieWrite[] = [];
  const response = {
    cookies: {
      set(name: string, value: string, options: CookieWrite["options"]) {
        writes.push({ name, value, options });
      },
    },
  } as unknown as NextResponse;

  return { response, writes };
}

function assertInviteCookieCleared(provider: OAuthProvider) {
  const { response, writes } = createResponseRecorder();
  setOAuthFlowCookies(response, provider, "state", "verifier");

  const inviteCookie = writes.find(
    (cookie) => cookie.name === getOAuthCookieNames(provider).invite,
  );
  assert.deepEqual(inviteCookie, {
    name: getOAuthCookieNames(provider).invite,
    value: "",
    options: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 0,
    },
  });
}

test("Google OAuth without invite clears a stale invite cookie", () => {
  assertInviteCookieCleared("google");
});

test("Microsoft OAuth without invite clears a stale invite cookie", () => {
  assertInviteCookieCleared("microsoft");
});

test("a normal OAuth flow cannot retain an invite from an abandoned flow", () => {
  const { response, writes } = createResponseRecorder();
  const inviteName = getOAuthCookieNames("google").invite;

  setOAuthFlowCookies(response, "google", "old-state", "old-verifier", "old-invite");
  setOAuthFlowCookies(response, "google", "new-state", "new-verifier");

  const inviteWrites = writes.filter((cookie) => cookie.name === inviteName);
  assert.equal(inviteWrites[0]?.value, "old-invite");
  assert.equal(inviteWrites.at(-1)?.value, "");
  assert.equal(inviteWrites.at(-1)?.options.maxAge, 0);
});
