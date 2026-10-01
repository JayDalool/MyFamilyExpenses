import crypto from "node:crypto";
import { buildInternalUrl } from "@/lib/auth/app-url";

export type OAuthProvider = "google" | "microsoft";

export interface OAuthUserInfo {
  providerAccountId: string;
  email: string;
  emailVerified: boolean;
  name: string;
  imageUrl?: string;
}

interface ProviderConfig {
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  enabled: boolean;
}

function getGoogleConfig(): ProviderConfig {
  return {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scopes: "openid email profile",
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUri: resolveRedirectUri("google", process.env.GOOGLE_REDIRECT_URI),
    enabled: process.env.GOOGLE_OAUTH_ENABLED === "true",
  };
}

function getMicrosoftConfig(): ProviderConfig {
  const tenant = process.env.MICROSOFT_TENANT_ID ?? "common";
  return {
    authUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    // Microsoft Identity Platform v2.0 publishes the OIDC userinfo endpoint on
    // graph.microsoft.com — login.microsoftonline.com/.../userinfo does not exist.
    // See https://learn.microsoft.com/en-us/entra/identity-platform/userinfo
    userInfoUrl: "https://graph.microsoft.com/oidc/userinfo",
    scopes: "openid email profile",
    clientId: process.env.MICROSOFT_CLIENT_ID ?? "",
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
    redirectUri: resolveRedirectUri("microsoft", process.env.MICROSOFT_REDIRECT_URI),
    enabled: process.env.MICROSOFT_OAUTH_ENABLED === "true",
  };
}

export function getProviderConfig(provider: OAuthProvider): ProviderConfig {
  return provider === "google" ? getGoogleConfig() : getMicrosoftConfig();
}

export function isOAuthEnabled(provider: OAuthProvider): boolean {
  const config = getProviderConfig(provider);

  return Boolean(
    config.enabled &&
      config.clientId.trim() &&
      config.clientSecret.trim() &&
      config.redirectUri.trim(),
  );
}

export function generateState(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildAuthUrl(
  provider: OAuthProvider,
  state: string,
  challenge: string,
): string {
  const config = getProviderConfig(provider);
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: config.scopes,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${config.authUrl}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  id_token?: string;
  expires_in?: number;
}

export async function exchangeCode(
  provider: OAuthProvider,
  code: string,
  verifier: string,
): Promise<TokenResponse> {
  const config = getProviderConfig(provider);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code_verifier: verifier,
  });

  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OAuthError(`Token exchange failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<TokenResponse>;
}

/**
 * Validates the raw userinfo payload from a provider. Exported so it can be
 * unit-tested independently of the network call.
 */
export function validateUserInfoResponse(
  data: unknown,
  provider: OAuthProvider = "google",
): OAuthUserInfo {
  if (!data || typeof data !== "object") {
    throw new OAuthError("Invalid userinfo response from provider.");
  }

  const d = data as Record<string, unknown>;

  if (!d.sub || typeof d.sub !== "string") {
    throw new OAuthError("Provider did not return a subject identifier.");
  }
  const email =
    typeof d.email === "string"
      ? d.email
      : provider === "microsoft" && typeof d.preferred_username === "string"
        ? d.preferred_username
        : null;

  if (!email) {
    throw new OAuthError("Provider did not return an email address.");
  }
  if (d.email_verified === false) {
    throw new OAuthUnverifiedEmailError();
  }

  const name =
    (typeof d.name === "string" ? d.name.trim() : "") ||
    [d.given_name, d.family_name]
      .filter((s) => typeof s === "string" && s)
      .join(" ")
      .trim() ||
    email;

  return {
    providerAccountId: d.sub,
    email: email.toLowerCase().trim(),
    emailVerified: d.email_verified !== false,
    name: name as string,
    imageUrl: typeof d.picture === "string" ? d.picture : undefined,
  };
}

export async function fetchUserInfo(
  provider: OAuthProvider,
  accessToken: string,
): Promise<OAuthUserInfo> {
  const config = getProviderConfig(provider);
  const res = await fetch(config.userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new OAuthError(`Userinfo request failed (${res.status}).`);
  }

  return validateUserInfoResponse(await res.json(), provider);
}

export class OAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthError";
  }
}

export class OAuthUnverifiedEmailError extends OAuthError {
  constructor() {
    super("Your email address has not been verified with the OAuth provider.");
    this.name = "OAuthUnverifiedEmailError";
  }
}

function resolveRedirectUri(provider: OAuthProvider, explicit?: string) {
  const configured = explicit?.trim();
  if (configured) {
    return configured;
  }

  try {
    return buildInternalUrl(`/api/auth/oauth/${provider}/callback`).toString();
  } catch {
    return "";
  }
}
