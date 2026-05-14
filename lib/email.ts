import nodemailer from "nodemailer";

const DEFAULT_SMTP_PORT = 587;

export class EmailDeliveryUnavailableError extends Error {
  constructor(message = "Email delivery is not configured.") {
    super(message);
    this.name = "EmailDeliveryUnavailableError";
  }
}

type SendSignupVerificationEmailInput = {
  email: string;
  name: string;
  verificationUrl: string;
};

type SendSignupVerificationEmailResult = {
  previewUrl?: string;
};

function smtpEnabled() {
  return process.env.SMTP_ENABLED === "true";
}

function smtpConfig() {
  return {
    host: process.env.SMTP_HOST?.trim() ?? "",
    port: Number(process.env.SMTP_PORT ?? DEFAULT_SMTP_PORT),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER?.trim() ?? "",
    password: process.env.SMTP_PASSWORD?.trim() ?? "",
    from: process.env.SMTP_FROM?.trim() ?? "",
  };
}

function canSendSmtpEmail() {
  const config = smtpConfig();

  return Boolean(
    smtpEnabled() &&
      config.host &&
      Number.isFinite(config.port) &&
      config.port > 0 &&
      config.from &&
      ((!config.user && !config.password) || (config.user && config.password)),
  );
}

/**
 * Return true only when the operator has explicitly opted into receiving the
 * verification URL in the signup API response. Production is always denied,
 * regardless of the flag, so a misconfigured NODE_ENV cannot turn a deployment
 * into an email-bypass.
 */
function shouldShowVerificationLinks(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.DEV_SHOW_VERIFICATION_LINKS === "true";
}

export async function sendSignupVerificationEmail({
  email,
  name,
  verificationUrl,
}: SendSignupVerificationEmailInput): Promise<SendSignupVerificationEmailResult> {
  if (!canSendSmtpEmail()) {
    if (process.env.NODE_ENV === "production") {
      throw new EmailDeliveryUnavailableError(
        "Public signup requires SMTP configuration before verification emails can be sent.",
      );
    }

    if (shouldShowVerificationLinks()) {
      console.info(`[signup] Verification link for ${email}: ${verificationUrl}`);
      return { previewUrl: verificationUrl };
    }

    console.info(
      `[signup] Verification email for ${email} could not be delivered (SMTP not configured). ` +
        "Set DEV_SHOW_VERIFICATION_LINKS=true to receive the link in the signup API response.",
    );
    return {};
  }

  const config = smtpConfig();
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.password } : undefined,
  });

  await transporter.sendMail({
    from: config.from,
    to: email,
    subject: "Verify your MyFamilyExpenses account",
    text: [
      `Hello ${name},`,
      "",
      "Click the link below to verify your email address and finish creating your account:",
      verificationUrl,
      "",
      "If you did not request this, you can ignore this email.",
    ].join("\n"),
    html: [
      `<p>Hello ${escapeHtml(name)},</p>`,
      "<p>Click the link below to verify your email address and finish creating your account:</p>",
      `<p><a href="${escapeHtml(verificationUrl)}">${escapeHtml(verificationUrl)}</a></p>`,
      "<p>If you did not request this, you can ignore this email.</p>",
    ].join(""),
  });

  return {};
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
