/**
 * Decide whether session, OAuth, and other auth cookies should be marked Secure.
 *
 * Resolution order:
 *   1. COOKIE_SECURE=true  → always Secure
 *   2. COOKIE_SECURE=false → never Secure (local dev only)
 *   3. fallback            → Secure iff NODE_ENV === "production"
 *
 * Always set COOKIE_SECURE=true in any deployment that serves over HTTPS,
 * including behind a TLS-terminating reverse proxy such as Cloudflare Tunnel.
 * Relying on NODE_ENV alone is fragile: self-hosted setups often forget to
 * set it, which would silently downgrade cookies to non-Secure.
 */
export function shouldUseSecureCookies(): boolean {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;
  return process.env.NODE_ENV === "production";
}
