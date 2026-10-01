import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { forgotPasswordSchema } from "@/lib/validation/auth";
import { extractClientIp } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import {
  isNativeFormRequest,
  readJsonOrFormPayload,
  redirectNativeForm,
} from "@/lib/http/form-request";
import {
  buildPasswordResetUrl,
  hashRequestMetadata,
  issuePasswordResetToken,
} from "@/lib/auth/password-reset";
import {
  EmailDeliveryUnavailableError,
  sendPasswordResetEmail,
} from "@/lib/email";
import {
  getPasswordResetRequestActorKeys,
  reservePasswordResetRequest,
} from "@/lib/auth/password-reset-rate-limit";

// One canonical response message for every outcome. Never branch the body
// based on whether the user exists — that is the entire point of the
// enumeration-mitigation for this route.
const GENERIC_MESSAGE =
  "If an account exists for that email, a password reset link has been sent.";

function genericResponse(request: Request, previewUrl?: string | null) {
  if (isNativeFormRequest(request)) {
    return redirectNativeForm(request, "/auth/forgot-password?status=sent");
  }
  return NextResponse.json(
    {
      data: {
        status: "sent",
        message: GENERIC_MESSAGE,
        ...(previewUrl ? { previewUrl } : {}),
      },
    },
    { status: 202 },
  );
}

function invalidResponse(request: Request) {
  if (isNativeFormRequest(request)) {
    return redirectNativeForm(request, "/auth/forgot-password?error=invalid");
  }
  return NextResponse.json(
    { error: { message: "Enter a valid email address." } },
    { status: 400 },
  );
}

function rateLimitResponse(request: Request) {
  if (isNativeFormRequest(request)) {
    return redirectNativeForm(request, "/auth/forgot-password?error=rate_limited");
  }
  return NextResponse.json(
    { error: { message: "Too many requests. Please try again later." } },
    { status: 429 },
  );
}

export async function POST(request: Request) {
  const payload = await readJsonOrFormPayload(request);
  const parsed = forgotPasswordSchema.safeParse(payload);

  // Validation failure is its own response: leaking "your email format was
  // wrong" does not leak account existence.
  if (!parsed.success) {
    return invalidResponse(request);
  }

  const { email } = parsed.data;
  const ip = extractClientIp(request);
  const userAgent = request.headers.get("user-agent");
  const actorKeys = getPasswordResetRequestActorKeys(request, { email });

  const allowed = await reservePasswordResetRequest(email, actorKeys);
  if (!allowed) {
    await writeAuditLog({
      action: "auth.password_reset.rate_limited",
      metadata: {
        emailHash: hashRequestMetadata(email),
        ipHash: hashRequestMetadata(ip),
      },
    });
    return rateLimitResponse(request);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true },
  });

  if (!user) {
    await writeAuditLog({
      action: "auth.password_reset.requested_unknown",
      metadata: {
        emailHash: hashRequestMetadata(email),
        ipHash: hashRequestMetadata(ip),
      },
    });
    return genericResponse(request);
  }

  try {
    const { token } = await issuePasswordResetToken({
      userId: user.id,
      ip,
      userAgent,
    });
    const resetUrl = buildPasswordResetUrl(token, request.url);
    const emailResult = await sendPasswordResetEmail({
      email: user.email,
      name: user.name,
      resetUrl,
    });

    await writeAuditLog({
      userId: user.id,
      action: "auth.password_reset.requested",
      metadata: {
        ipHash: hashRequestMetadata(ip),
        userAgentHash: hashRequestMetadata(userAgent),
      },
    });

    return genericResponse(request, emailResult.previewUrl);
  } catch (error) {
    // Both EmailDeliveryUnavailableError and any other unexpected error must
    // still return the generic body. Diverging the response for known users
    // (e.g. returning 503 only when SMTP is misconfigured AND the email is
    // recognised) would leak account existence. The operator-visible failure
    // is recorded in audit + console; the API surface stays uniform.
    if (error instanceof EmailDeliveryUnavailableError) {
      console.error(
        "[forgot-password] SMTP unavailable — recognised request silently dropped to preserve enumeration mitigation. " +
          "Configure SMTP_* to deliver reset emails.",
      );
      await writeAuditLog({
        userId: user.id,
        action: "auth.password_reset.email_unavailable",
        metadata: { ipHash: hashRequestMetadata(ip) },
      });
    } else {
      console.error("[forgot-password] unexpected error:", error);
      await writeAuditLog({
        userId: user.id,
        action: "auth.password_reset.error",
        metadata: { ipHash: hashRequestMetadata(ip) },
      });
    }
    return genericResponse(request);
  }
}
