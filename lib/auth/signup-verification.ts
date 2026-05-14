import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { buildInternalUrl } from "@/lib/auth/app-url";

const SIGNUP_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export function createSignupVerificationToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function hashSignupVerificationToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function getSignupVerificationExpiry() {
  return new Date(Date.now() + SIGNUP_VERIFICATION_TTL_MS);
}

export async function savePendingSignup(input: {
  email: string;
  name: string;
  passwordHash: string;
  token: string;
}) {
  return prisma.pendingSignup.upsert({
    where: { email: input.email },
    update: {
      name: input.name,
      passwordHash: input.passwordHash,
      verificationTokenHash: hashSignupVerificationToken(input.token),
      expiresAt: getSignupVerificationExpiry(),
    },
    create: {
      email: input.email,
      name: input.name,
      passwordHash: input.passwordHash,
      verificationTokenHash: hashSignupVerificationToken(input.token),
      expiresAt: getSignupVerificationExpiry(),
    },
  });
}

export async function deletePendingSignupByEmail(email: string) {
  await prisma.pendingSignup.deleteMany({
    where: { email },
  });
}

export function buildSignupVerificationUrl(token: string, fallbackUrl?: string) {
  const url = buildInternalUrl(`/api/auth/signup/verify?token=${encodeURIComponent(token)}`, fallbackUrl);
  return url.toString();
}
