import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createSession, setActiveHouseholdCookie } from "@/lib/auth/session";
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
import { acceptHouseholdInviteForUser } from "@/lib/household-invites";
import { inviteTokenSchema } from "@/lib/validation/household";
import { getInviteRequestActorKeys } from "@/lib/invite-rate-limit";

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
  const inviteTokenResult = inviteTokenSchema.safeParse(
    payload && typeof payload === "object" && "inviteToken" in payload
      ? payload.inviteToken
      : undefined,
  );
  const inviteToken = inviteTokenResult.success ? inviteTokenResult.data : null;

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

  const inviteAcceptance = inviteToken
    ? await acceptHouseholdInviteForUser(
        inviteToken,
        user,
        getInviteRequestActorKeys(request, { userId: user.id, email: user.email }),
      )
    : null;

  const acceptedHouseholdId = inviteAcceptance?.ok
    ? inviteAcceptance.householdId
    : inviteAcceptance?.reason === "duplicate_membership"
      ? inviteAcceptance.householdId
      : null;
  if (acceptedHouseholdId) {
    await setActiveHouseholdCookie(acceptedHouseholdId);
  }

  // Verify or provision household membership
  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, removedAt: null },
  });

  if (!membership) {
    if (BOOTSTRAP_ENABLED) {
      await ensureUserHousehold(user.id, user.name);
    } else {
      console.error(`[login] User ${user.email} (${user.id}) has no household membership.`);
      await recordLoginAttempt(email, ip, true);
      await createSession(user.id);
      await writeAuditLog({
        userId: user.id,
        action: "auth.login.no_household",
        metadata: { email, ip, reason: "missing_household" },
      });
      if (isNativeFormRequest(request)) {
        return redirectNativeForm(request, "/no-household");
      }
      return NextResponse.json({ data: { redirectTo: "/no-household" } });
    }
  }

  await recordLoginAttempt(email, ip, true);
  await createSession(user.id);
  const activeMembership =
    membership ??
    (await prisma.membership.findFirst({ where: { userId: user.id, removedAt: null } }));

  await writeAuditLog({
    userId: user.id,
    householdId: activeMembership?.householdId ?? null,
    action: "auth.login.success",
    metadata: { email, ip },
  });

  const inviteHandled =
    inviteAcceptance?.ok || inviteAcceptance?.reason === "duplicate_membership";
  const redirectTo =
    inviteToken && !inviteHandled
      ? `/invite/${encodeURIComponent(inviteToken)}`
      : "/dashboard";

  if (isNativeFormRequest(request)) {
    return redirectNativeForm(request, redirectTo);
  }

  return NextResponse.json({
    data: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      redirectTo,
    },
  });
}
