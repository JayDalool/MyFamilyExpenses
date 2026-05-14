import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createSession } from "@/lib/auth/session";
import { buildInternalUrl } from "@/lib/auth/app-url";
import { hashSignupVerificationToken } from "@/lib/auth/signup-verification";
import { onboardNewUserInTransaction } from "@/lib/auth/onboarding";

function redirectWithCode(requestUrl: string, code: string) {
  return NextResponse.redirect(buildInternalUrl(`/auth/login?error=${code}`, requestUrl));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token")?.trim();

  if (!token) {
    return redirectWithCode(request.url, "signup_verification_invalid");
  }

  const tokenHash = hashSignupVerificationToken(token);
  const pendingSignup = await prisma.pendingSignup.findUnique({
    where: { verificationTokenHash: tokenHash },
  });

  if (!pendingSignup) {
    return redirectWithCode(request.url, "signup_verification_invalid");
  }

  if (pendingSignup.expiresAt <= new Date()) {
    await prisma.pendingSignup.deleteMany({
      where: { id: pendingSignup.id },
    });

    return redirectWithCode(request.url, "signup_verification_expired");
  }

  try {
    const user = await prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: { email: pendingSignup.email },
      });

      if (existingUser) {
        await tx.pendingSignup.delete({
          where: { id: pendingSignup.id },
        });

        return null;
      }

      const onboardedUser = await onboardNewUserInTransaction(tx, {
        name: pendingSignup.name,
        email: pendingSignup.email,
        passwordHash: pendingSignup.passwordHash,
        emailVerifiedAt: new Date(),
      });

      await tx.pendingSignup.delete({
        where: { id: pendingSignup.id },
      });

      return onboardedUser;
    });

    if (!user) {
      return redirectWithCode(request.url, "signup_email_exists");
    }

    await createSession(user.id);

    return NextResponse.redirect(buildInternalUrl("/dashboard", request.url));
  } catch (error) {
    console.error("[signup/verify] verification error:", error);
    return redirectWithCode(request.url, "signup_verification_invalid");
  }
}
