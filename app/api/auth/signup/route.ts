import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import { signupSchema } from "@/lib/validation/auth";
import { extractClientIp, isSignupRateLimited, recordLoginAttempt } from "@/lib/rate-limit";
import {
  buildSignupVerificationUrl,
  createSignupVerificationToken,
  deletePendingSignupByEmail,
  savePendingSignup,
} from "@/lib/auth/signup-verification";
import { EmailDeliveryUnavailableError, sendSignupVerificationEmail } from "@/lib/email";
import { writeAuditLog } from "@/lib/audit";
import {
  isNativeFormRequest,
  readJsonOrFormPayload,
  redirectNativeForm,
} from "@/lib/http/form-request";

const SIGNUP_SUCCESS_MSG =
  "Check your email for a verification link to finish creating your account.";

function verificationSentResponse(request: Request, previewUrl?: string) {
  if (isNativeFormRequest(request)) {
    return redirectNativeForm(request, "/auth/signup?status=verification_sent");
  }

  return NextResponse.json(
    {
      data: {
        status: "verification_sent",
        message: SIGNUP_SUCCESS_MSG,
        ...(previewUrl ? { previewUrl } : {}),
      },
    },
    { status: 202 },
  );
}

function signupErrorResponse(
  request: Request,
  message: string,
  status: number,
  errorCode: string,
) {
  if (isNativeFormRequest(request)) {
    return redirectNativeForm(request, `/auth/signup?error=${errorCode}`);
  }

  return NextResponse.json({ error: { message } }, { status });
}

export async function POST(request: Request) {
  const ip = extractClientIp(request);
  const payload = await readJsonOrFormPayload(request);
  const parsed = signupSchema.safeParse(payload);

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return signupErrorResponse(
      request,
      first?.message ?? "Invalid input.",
      400,
      "signup_invalid",
    );
  }

  const { name, email, password } = parsed.data;

  if (await isSignupRateLimited(email, ip)) {
    await writeAuditLog({
      action: "auth.signup.rate_limited",
      metadata: { email, ip },
    });
    return signupErrorResponse(
      request,
      "Too many attempts. Please try again later.",
      429,
      "signup_rate_limited",
    );
  }

  // Email enumeration mitigation: when the email is already registered we still
  // return the same "verification_sent" body that a brand-new signup would, and
  // we burn a bcrypt hash so the response time is roughly aligned with the real
  // path. We deliberately do NOT create a pending signup or send an email so
  // that an attacker probing for existing accounts cannot spam the legitimate
  // user's inbox. Timing is not perfectly constant (the real path still does
  // a DB write + SMTP send), but the response body — the easy-to-script signal
  // — is now indistinguishable.
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await hashPassword(password).catch(() => undefined);
    await recordLoginAttempt(email, ip, false);
    await writeAuditLog({
      userId: existing.id,
      action: "auth.signup.existing_email",
      metadata: { email, ip },
    });
    return verificationSentResponse(request);
  }

  const passwordHash = await hashPassword(password);
  const verificationToken = createSignupVerificationToken();
  let verificationReady = false;

  try {
    await savePendingSignup({
      email,
      name,
      passwordHash,
      token: verificationToken,
    });

    const verificationUrl = buildSignupVerificationUrl(verificationToken, request.url);
    const emailResult = await sendSignupVerificationEmail({
      email,
      name,
      verificationUrl,
    });
    verificationReady = true;

    await recordLoginAttempt(email, ip, true);
    await writeAuditLog({
      action: "auth.signup.pending",
      metadata: { email, ip },
    });
    return verificationSentResponse(request, emailResult.previewUrl);
  } catch (err) {
    // Race: pre-check passed but a concurrent signup just created the user.
    // Treat the same as the existing-user case to avoid leaking via status.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      await recordLoginAttempt(email, ip, false);
      await writeAuditLog({
        action: "auth.signup.existing_email",
        metadata: { email, ip, reason: "race" },
      });
      return verificationSentResponse(request);
    }

    if (err instanceof EmailDeliveryUnavailableError) {
      await deletePendingSignupByEmail(email);
      return signupErrorResponse(request, err.message, 503, "signup_unavailable");
    }

    if (!verificationReady) {
      await deletePendingSignupByEmail(email);
    }
    throw err;
  }
}
