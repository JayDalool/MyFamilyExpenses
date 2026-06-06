import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createSession } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { loginSchema } from "@/lib/validation/auth";
import { ensureUserHousehold } from "@/lib/auth/household";
import { extractClientIp, isRateLimited, recordLoginAttempt } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import {
  isNativeFormRequest,
  readJsonOrFormPayload,
  redirectNativeForm,
} from "@/lib/http/form-request";

const GENERIC_ERROR = "Invalid email or password.";

// Set ALLOW_LOGIN_HOUSEHOLD_BOOTSTRAP=true only during initial deployment of new
// users. Default is false: existing users without a household get a clear error
// instead of silently creating an empty household that would break the backfill.
const BOOTSTRAP_ENABLED = process.env.ALLOW_LOGIN_HOUSEHOLD_BOOTSTRAP === "true";

function loginErrorResponse(
  request: Request,
  message: string,
  status: number,
  errorCode = "login_failed",
) {
  if (isNativeFormRequest(request)) {
    return redirectNativeForm(request, `/auth/login?error=${errorCode}`);
  }

  return NextResponse.json({ error: { message } }, { status });
}

export async function POST(request: Request) {
  const ip = extractClientIp(request);
  const payload = await readJsonOrFormPayload(request);
  const parsed = loginSchema.safeParse(payload);

  if (!parsed.success) {
    return loginErrorResponse(request, GENERIC_ERROR, 400);
  }

  const { email, password } = parsed.data; // email is already lowercased by loginSchema

  if (await isRateLimited(email, ip)) {
    await writeAuditLog({
      action: "auth.login.rate_limited",
      metadata: { email, ip },
    });
    return loginErrorResponse(
      request,
      "Too many failed login attempts. Please try again later.",
      429,
      "login_rate_limited",
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    await recordLoginAttempt(email, ip, false);
    await writeAuditLog({
      action: "auth.login.failed",
      metadata: { email, ip, reason: "user_not_found" },
    });
    return loginErrorResponse(request, GENERIC_ERROR, 401);
  }

  // OAuth-only users have no password — reject with the generic message to avoid leaking
  // information about which auth method an account uses.
  if (!user.passwordHash) {
    await recordLoginAttempt(email, ip, false);
    await writeAuditLog({
      userId: user.id,
      action: "auth.login.failed",
      metadata: { email, ip, reason: "password_unavailable" },
    });
    return loginErrorResponse(request, GENERIC_ERROR, 401);
  }

  const isValidPassword = await verifyPassword(password, user.passwordHash);

  if (!isValidPassword) {
    await recordLoginAttempt(email, ip, false);
    await writeAuditLog({
      userId: user.id,
      action: "auth.login.failed",
      metadata: { email, ip, reason: "invalid_password" },
    });
    return loginErrorResponse(request, GENERIC_ERROR, 401);
  }

  // Verify or provision household membership
  const membership = await prisma.membership.findFirst({ where: { userId: user.id } });

  if (!membership) {
    if (BOOTSTRAP_ENABLED) {
      await ensureUserHousehold(user.id, user.name);
    } else {
      // User has no household. This happens when:
      //   a) The backfill script has not been run yet, or
      //   b) The user was created outside the normal signup flow.
      // Do NOT auto-create a household here: it would leave existing expenses
      // with NULL household_id, which the backfill would then never fix.
      console.error(`[login] User ${user.email} (${user.id}) has no household membership.`);
      await recordLoginAttempt(email, ip, false);
      await writeAuditLog({
        userId: user.id,
        action: "auth.login.failed",
        metadata: { email, ip, reason: "missing_household" },
      });
      return loginErrorResponse(
        request,
        "Account setup is incomplete. Please contact an administrator.",
        403,
        "login_incomplete",
      );
    }
  }

  await recordLoginAttempt(email, ip, true);
  await createSession(user.id);
  const activeMembership =
    membership ?? (await prisma.membership.findFirst({ where: { userId: user.id } }));

  await writeAuditLog({
    userId: user.id,
    householdId: activeMembership?.householdId ?? null,
    action: "auth.login.success",
    metadata: { email, ip },
  });

  if (isNativeFormRequest(request)) {
    return redirectNativeForm(request, "/dashboard");
  }

  return NextResponse.json({
    data: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    },
  });
}
