import { prisma } from "@/lib/db/prisma";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_EMAIL = 5;
const MAX_FAILURES_PER_IP = 20;
const MAX_SIGNUPS_PER_EMAIL = 3;
const MAX_SIGNUPS_PER_IP = 10;

function windowStart() {
  return new Date(Date.now() - WINDOW_MS);
}

export async function isRateLimited(email: string, ip: string | null): Promise<boolean> {
  const since = windowStart();

  const [emailCount, ipCount] = await Promise.all([
    prisma.loginAttempt.count({
      where: { email, success: false, createdAt: { gte: since } },
    }),
    ip
      ? prisma.loginAttempt.count({
          where: { ip, success: false, createdAt: { gte: since } },
        })
      : Promise.resolve(0),
  ]);

  return emailCount >= MAX_FAILURES_PER_EMAIL || ipCount >= MAX_FAILURES_PER_IP;
}

export async function isSignupRateLimited(email: string, ip: string | null): Promise<boolean> {
  const since = windowStart();

  const [emailCount, ipCount] = await Promise.all([
    prisma.loginAttempt.count({
      where: { email, createdAt: { gte: since } },
    }),
    ip
      ? prisma.loginAttempt.count({
          where: { ip, createdAt: { gte: since } },
        })
      : Promise.resolve(0),
  ]);

  return emailCount >= MAX_SIGNUPS_PER_EMAIL || ipCount >= MAX_SIGNUPS_PER_IP;
}

export async function recordLoginAttempt(
  email: string,
  ip: string | null,
  success: boolean,
): Promise<void> {
  await prisma.loginAttempt.create({ data: { email, ip, success } });
}

/**
 * Extract the client IP from the request.
 *
 * Set TRUST_PROXY_HEADERS=true only when the app runs exclusively behind
 * Cloudflare Tunnel or a trusted reverse proxy. Never enable this if the app
 * port is also directly reachable — forwarded headers can be spoofed.
 *
 * When false (default), IP-based rate limiting is disabled; email-based limiting
 * still applies and is the primary defence.
 */
export function extractClientIp(request: Request): string | null {
  const trustProxy = process.env.TRUST_PROXY_HEADERS === "true";

  if (!trustProxy) {
    return null;
  }

  // Cloudflare Tunnel sets cf-connecting-ip. Prefer it over x-forwarded-for
  // because Cloudflare strips client-supplied cf-connecting-ip headers.
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  // Standard reverse-proxy header — first entry is the originating client.
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();

  return null;
}
