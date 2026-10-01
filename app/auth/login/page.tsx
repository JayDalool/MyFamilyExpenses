import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getCurrentHousehold, getCurrentUser } from "@/lib/auth/session";
import { isOAuthEnabled } from "@/lib/auth/oauth";
import { getRequestCsrfToken } from "@/lib/auth/csrf-server";

const OAUTH_ERRORS: Record<string, string> = {
  oauth_denied: "Authorization was cancelled.",
  oauth_disabled: "This sign-in method is not enabled.",
  oauth_invalid: "The sign-in request was invalid. Please try again.",
  oauth_state_mismatch: "The sign-in request expired or was invalid. Please try again.",
  oauth_unverified_email: "Your email address is not verified with the provider.",
  oauth_email_exists:
    "An account with this email already exists. Please sign in with your password instead.",
  oauth_error: "Sign in failed. Please try again.",
  signup_verification_invalid: "That verification link is invalid. Please sign up again.",
  signup_verification_expired:
    "That verification link has expired. Please sign up again to get a new one.",
  signup_email_exists:
    "An account with this email already exists. Please sign in or reset your password.",
  login_failed: "Invalid email or password.",
  login_rate_limited: "Too many failed login attempts. Please try again later.",
  login_incomplete: "Account setup is incomplete. Please contact an administrator.",
  invite_invalid: "This household invite is no longer valid for this account.",
};

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await getCurrentUser();
  if (user) {
    const auth = await getCurrentHousehold();
    redirect(auth ? "/dashboard" : "/no-household");
  }

  const params = await searchParams;
  const inviteToken = typeof params.invite === "string" ? params.invite : null;
  const errorKey = typeof params.error === "string" ? params.error : undefined;
  const oauthError = errorKey
    ? (OAUTH_ERRORS[errorKey] ?? "Sign in failed. Please try again.")
    : null;
  const statusKey = typeof params.status === "string" ? params.status : undefined;
  const initialSuccessMessage =
    statusKey === "password_reset"
      ? "Password updated. Sign in with your new password."
      : null;

  const googleEnabled = isOAuthEnabled("google");
  const microsoftEnabled = isOAuthEnabled("microsoft");
  const csrfToken = await getRequestCsrfToken();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-brand-50 via-white to-slate-100 px-4 py-12">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-4 text-center">
          {/* Brand mark: swap public/brand/logo-mark.svg to change everywhere. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG */}
          <img
            alt=""
            className="h-16 w-16 rounded-2xl shadow-lg"
            height={64}
            src="/brand/logo-mark.svg"
            width={64}
          />

          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              My Expenses
            </h1>
            <p className="mt-1.5 text-sm text-slate-500">
              Snap receipts. Track spending. Stay in sync.
            </p>
          </div>
        </div>

        <LoginForm
          csrfToken={csrfToken}
          inviteToken={inviteToken}
          googleEnabled={googleEnabled}
          microsoftEnabled={microsoftEnabled}
          oauthError={oauthError}
          initialSuccessMessage={initialSuccessMessage}
        />

        <p className="text-center text-xs text-slate-400">
          Self-hosted &middot; Private &middot; Family-first
        </p>
      </div>
    </div>
  );
}
