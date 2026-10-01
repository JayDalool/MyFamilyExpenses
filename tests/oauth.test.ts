import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  generateState,
  generatePKCE,
  getProviderConfig,
  isOAuthEnabled,
  validateUserInfoResponse,
  OAuthError,
  OAuthUnverifiedEmailError,
} from "../lib/auth/oauth";

// ── State + PKCE ──────────────────────────────────────────────────────────────

test("generateState returns a 64-character lowercase hex string", () => {
  const state = generateState();
  assert.equal(typeof state, "string");
  assert.equal(state.length, 64);
  assert.match(state, /^[0-9a-f]{64}$/);
});

test("generateState returns a different value each call", () => {
  assert.notEqual(generateState(), generateState());
});

test("generatePKCE returns a verifier and a challenge string", () => {
  const { verifier, challenge } = generatePKCE();
  assert.equal(typeof verifier, "string");
  assert.equal(typeof challenge, "string");
  assert.ok(verifier.length > 0);
  assert.ok(challenge.length > 0);
});

test("PKCE challenge is SHA-256(verifier) encoded as base64url", () => {
  const { verifier, challenge } = generatePKCE();
  const expected = crypto.createHash("sha256").update(verifier).digest("base64url");
  assert.equal(challenge, expected);
});

test("generatePKCE verifier and challenge differ between calls", () => {
  const a = generatePKCE();
  const b = generatePKCE();
  assert.notEqual(a.verifier, b.verifier);
  assert.notEqual(a.challenge, b.challenge);
});

test("Microsoft provider uses the graph.microsoft.com OIDC userinfo endpoint", () => {
  const previous = process.env.MICROSOFT_TENANT_ID;
  try {
    process.env.MICROSOFT_TENANT_ID = "common";
    const config = getProviderConfig("microsoft");
    assert.equal(config.userInfoUrl, "https://graph.microsoft.com/oidc/userinfo");
  } finally {
    process.env.MICROSOFT_TENANT_ID = previous;
  }
});

test("Microsoft userinfo endpoint stays on graph.microsoft.com regardless of tenant", () => {
  const previous = process.env.MICROSOFT_TENANT_ID;
  try {
    process.env.MICROSOFT_TENANT_ID = "9c1b3d2a-1111-2222-3333-444455556666";
    const config = getProviderConfig("microsoft");
    assert.equal(config.userInfoUrl, "https://graph.microsoft.com/oidc/userinfo");
  } finally {
    process.env.MICROSOFT_TENANT_ID = previous;
  }
});

test("Microsoft authorize and token endpoints stay tenant-specific", () => {
  const previous = process.env.MICROSOFT_TENANT_ID;
  try {
    process.env.MICROSOFT_TENANT_ID = "tenant-abc";
    const config = getProviderConfig("microsoft");
    assert.equal(
      config.authUrl,
      "https://login.microsoftonline.com/tenant-abc/oauth2/v2.0/authorize",
    );
    assert.equal(
      config.tokenUrl,
      "https://login.microsoftonline.com/tenant-abc/oauth2/v2.0/token",
    );
  } finally {
    process.env.MICROSOFT_TENANT_ID = previous;
  }
});

test("Google userinfo endpoint stays on Google's OIDC userinfo", () => {
  const config = getProviderConfig("google");
  assert.equal(config.userInfoUrl, "https://openidconnect.googleapis.com/v1/userinfo");
});

test("isOAuthEnabled stays false when provider credentials are incomplete", () => {
  const previous = {
    APP_BASE_URL: process.env.APP_BASE_URL,
    GOOGLE_OAUTH_ENABLED: process.env.GOOGLE_OAUTH_ENABLED,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
  };

  try {
    process.env.APP_BASE_URL = "https://your-app.example.com";
    process.env.GOOGLE_OAUTH_ENABLED = "true";
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "";
    process.env.GOOGLE_REDIRECT_URI = "";

    assert.equal(isOAuthEnabled("google"), false);
  } finally {
    process.env.APP_BASE_URL = previous.APP_BASE_URL;
    process.env.GOOGLE_OAUTH_ENABLED = previous.GOOGLE_OAUTH_ENABLED;
    process.env.GOOGLE_CLIENT_ID = previous.GOOGLE_CLIENT_ID;
    process.env.GOOGLE_CLIENT_SECRET = previous.GOOGLE_CLIENT_SECRET;
    process.env.GOOGLE_REDIRECT_URI = previous.GOOGLE_REDIRECT_URI;
  }
});

// ── validateUserInfoResponse ──────────────────────────────────────────────────

test("validateUserInfoResponse rejects null payload", () => {
  assert.throws(() => validateUserInfoResponse(null), OAuthError);
});

test("validateUserInfoResponse rejects missing sub", () => {
  assert.throws(
    () => validateUserInfoResponse({ email: "user@example.com" }),
    OAuthError,
  );
});

test("validateUserInfoResponse rejects missing email", () => {
  assert.throws(
    () => validateUserInfoResponse({ sub: "123" }),
    OAuthError,
  );
});

test("validateUserInfoResponse rejects explicitly unverified email", () => {
  assert.throws(
    () =>
      validateUserInfoResponse({
        sub: "123",
        email: "user@example.com",
        email_verified: false,
      }),
    OAuthUnverifiedEmailError,
  );
});

test("validateUserInfoResponse normalizes email to lowercase", () => {
  const info = validateUserInfoResponse({
    sub: "123",
    email: "USER@EXAMPLE.COM",
    email_verified: true,
    name: "Test User",
  });
  assert.equal(info.email, "user@example.com");
});

test("validateUserInfoResponse accepts absent email_verified as verified", () => {
  const info = validateUserInfoResponse({
    sub: "abc",
    email: "user@example.com",
    name: "Test User",
  });
  assert.ok(info.emailVerified);
});

test("validateUserInfoResponse sets providerAccountId from sub", () => {
  const info = validateUserInfoResponse({
    sub: "google-sub-12345",
    email: "user@example.com",
    name: "Test User",
    email_verified: true,
  });
  assert.equal(info.providerAccountId, "google-sub-12345");
});

test("validateUserInfoResponse falls back to email as name if name is absent", () => {
  const info = validateUserInfoResponse({
    sub: "abc",
    email: "user@example.com",
    email_verified: true,
  });
  assert.equal(info.name, "user@example.com");
});

test("validateUserInfoResponse assembles name from given_name and family_name", () => {
  const info = validateUserInfoResponse({
    sub: "abc",
    email: "user@example.com",
    email_verified: true,
    given_name: "Jane",
    family_name: "Doe",
  });
  assert.equal(info.name, "Jane Doe");
});

test("validateUserInfoResponse captures picture as imageUrl", () => {
  const info = validateUserInfoResponse({
    sub: "abc",
    email: "user@example.com",
    email_verified: true,
    name: "Test",
    picture: "https://example.com/avatar.png",
  });
  assert.equal(info.imageUrl, "https://example.com/avatar.png");
});

test("validateUserInfoResponse accepts Microsoft preferred_username as email fallback", () => {
  const info = validateUserInfoResponse(
    {
      sub: "abc",
      preferred_username: "User@Example.com",
      name: "Microsoft User",
    },
    "microsoft",
  );

  assert.equal(info.email, "user@example.com");
  assert.equal(info.name, "Microsoft User");
});

// ── Error classes ─────────────────────────────────────────────────────────────

test("OAuthError is an instance of Error", () => {
  const err = new OAuthError("something went wrong");
  assert.ok(err instanceof Error);
  assert.equal(err.name, "OAuthError");
  assert.equal(err.message, "something went wrong");
});

test("OAuthUnverifiedEmailError is an OAuthError", () => {
  const err = new OAuthUnverifiedEmailError();
  assert.ok(err instanceof OAuthError);
  assert.equal(err.name, "OAuthUnverifiedEmailError");
  assert.match(err.message, /not been verified/i);
});
