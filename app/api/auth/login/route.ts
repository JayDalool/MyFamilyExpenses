import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createSession } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { loginSchema } from "@/lib/validation/auth";
import { ensureUserHousehold } from "@/lib/auth/household";
import { extractClientIp, isRateLimited, recordLoginAttempt } from "@/lib/rate-limit";

const GENERIC_ERROR = "Invalid email or password.";

// Set ALLOW_LOGIN_HOUSEHOLD_BOOTSTRAP=true only during initial deployment of new
// users. Default is false: existing users without a household get a clear error
// instead of silently creating an empty household that would break the backfill.
const BOOTSTRAP_ENABLED = process.env.ALLOW_LOGIN_HOUSEHOLD_BOOTSTRAP === "true";

export async function POST(request: Request) {
  const ip = extractClientIp(request);
  const payload = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: GENERIC_ERROR } },
      { status: 400 },
    );
  }

  const { email, password } = parsed.data; // email is already lowercased by loginSchema

  if (await isRateLimited(email, ip)) {
    return NextResponse.json(
      { error: { message: "Too many failed login attempts. Please try again later." } },
      { status: 429 },
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    await recordLoginAttempt(email, ip, false);
    return NextResponse.json({ error: { message: GENERIC_ERROR } }, { status: 401 });
  }

  const isValidPassword = await verifyPassword(password, user.passwordHash);

  if (!isValidPassword) {
    await recordLoginAttempt(email, ip, false);
    return NextResponse.json({ error: { message: GENERIC_ERROR } }, { status: 401 });
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
      return NextResponse.json(
        {
          error: {
            message:
              "Account setup is incomplete. Please contact an administrator.",
          },
        },
        { status: 403 },
      );
    }
  }

  await recordLoginAttempt(email, ip, true);
  await createSession(user.id);

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
