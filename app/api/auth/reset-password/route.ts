import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import { resetPasswordSchema } from "@/lib/validation/auth";
import { extractClientIp } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import {
  isNativeFormRequest,
  readJsonOrFormPayload,
  redirectNativeForm,
} from "@/lib/http/form-request";
import {
  consumePasswordResetTokenInTransaction,
  hashPasswordResetToken,
  hashRequestMetadata,
  invalidateAllSessionsForUser,
  invalidateOtherActiveTokens,
  PasswordResetTokenError,
} from "@/lib/auth/password-reset";
import {
  getPasswordResetRequestActorKeys,
  reservePasswordResetAttempt,
} from "@/lib/auth/password-reset-rate-limit";

// Single generic invalid response for missing / expired / used / invalid token,
// so callers cannot tell which failure mode they hit. The exact reason is
// recorded in audit logs (token-hash-only, never the raw token).
const GENERIC_INVALID =
  "This password reset link is invalid or has expired. Request a new one.";

function invalidTokenResponse(request: Request) {
  if (isNativeFormRequest(request)) {
    return redirectNativeForm(request, "/auth/reset-password?error=invalid");
  }
  return NextResponse.json(
    { error: { message: GENERIC_INVALID } },
    { status: 400 },
  );
}

function passwordValidationResponse(request: Request, message: string) {
  if (isNativeFormRequest(request)) {
    return redirectNativeForm(request, "/auth/reset-password?error=password");
  }
  return NextResponse.json({ error: { message } }, { status: 400 });
}

function rateLimitResponse(request: Request) {
  if (isNativeFormRequest(request)) {
    return redirectNativeForm(request, "/auth/reset-password?error=rate_limited");
  }
  return NextResponse.json(
    { error: { message: "Too many attempts. Please try again later." } },
    { status: 429 },
  );
}

function successResponse(request: Request) {
  if (isNativeFormRequest(request)) {
    return redirectNativeForm(request, "/auth/login?status=password_reset");
  }
  return NextResponse.json({
    data: {
      status: "password_reset",
      message: "Password updated. You can now sign in.",
      redirectTo: "/auth/login?status=password_reset",
    },
  });
}

export async function POST(request: Request) {
  const payload = await readJsonOrFormPayload(request);
  const parsed = resetPasswordSchema.safeParse(payload);

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    // If the field at fault is the token, treat it as the generic invalid
    // case so we do not leak that it is the token that failed parsing vs.
    // password rules.
    if (first?.path?.[0] === "token") {
      return invalidTokenResponse(request);
    }
    return passwordValidationResponse(
      request,
      first?.message ?? "Invalid input.",
    );
  }

  const { token, password } = parsed.data;
  const tokenHash = hashPasswordResetToken(token);
  const ip = extractClientIp(request);
  const actorKeys = getPasswordResetRequestActorKeys(request);

  const allowed = await reservePasswordResetAttempt(tokenHash, actorKeys);
  if (!allowed) {
    await writeAuditLog({
      action: "auth.password_reset.attempt_rate_limited",
      metadata: { tokenHash, ipHash: hashRequestMetadata(ip) },
    });
    return rateLimitResponse(request);
  }

  try {
    const passwordHash = await hashPassword(password);
    const result = await prisma.$transaction(async (tx) => {
      const { token: consumed } = await consumePasswordResetTokenInTransaction(
        tx,
        token,
      );
      // Update password. For OAuth-only users (passwordHash was null), this is
      // an explicit opt-in to also having a password — they keep their OAuth
      // accounts and can sign in either way going forward.
      const user = await tx.user.update({
        where: { id: consumed.userId },
        data: { passwordHash },
        select: {
          id: true,
          email: true,
          emailVerifiedAt: true,
        },
      });

      await invalidateOtherActiveTokens(tx, user.id, consumed.id);
      await invalidateAllSessionsForUser(tx, user.id);

      return user;
    });

    await writeAuditLog({
      userId: result.id,
      action: "auth.password_reset.completed",
      metadata: {
        tokenHash,
        ipHash: hashRequestMetadata(ip),
      },
    });

    return successResponse(request);
  } catch (error) {
    if (error instanceof PasswordResetTokenError) {
      await writeAuditLog({
        action: "auth.password_reset.failed",
        metadata: {
          tokenHash,
          reason: error.reason,
          ipHash: hashRequestMetadata(ip),
        },
      });
      return invalidTokenResponse(request);
    }
    console.error("[reset-password] unexpected error:", error);
    await writeAuditLog({
      action: "auth.password_reset.error",
      metadata: { tokenHash, ipHash: hashRequestMetadata(ip) },
    });
    return invalidTokenResponse(request);
  }
}
