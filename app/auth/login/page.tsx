import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getCurrentUser } from "@/lib/auth/session";
import { isOAuthEnabled } from "@/lib/auth/oauth";

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
};

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  const params = await searchParams;
  const errorKey = typeof params.error === "string" ? params.error : undefined;
  const oauthError = errorKey
    ? (OAUTH_ERRORS[errorKey] ?? "Sign in failed. Please try again.")
    : null;

  const googleEnabled = isOAuthEnabled("google");
  const microsoftEnabled = isOAuthEnabled("microsoft");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-brand-50 via-white to-slate-100 px-4 py-12">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-600 shadow-lg">
            <svg
              className="h-9 w-9 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z"
              />
            </svg>
          </div>

          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              MyFamilyExpenses
            </h1>
            <p className="mt-1.5 text-sm text-slate-500">
              Snap receipts. Track spending. Stay in sync.
            </p>
          </div>
        </div>

        <LoginForm
          googleEnabled={googleEnabled}
          microsoftEnabled={microsoftEnabled}
          oauthError={oauthError}
        />

        <p className="text-center text-xs text-slate-400">
          Self-hosted &middot; Private &middot; Family-first
        </p>
      </div>
    </div>
  );
}
