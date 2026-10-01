import { redirect } from "next/navigation";
import { SignupForm } from "@/components/signup-form";
import { getCurrentHousehold, getCurrentUser } from "@/lib/auth/session";
import { getRequestCsrfToken } from "@/lib/auth/csrf-server";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const SIGNUP_ERRORS: Record<string, string> = {
  signup_invalid: "Check the form fields and try again.",
  signup_rate_limited: "Too many attempts. Please try again later.",
  signup_unavailable: "Sign up is temporarily unavailable. Please try again later.",
  invite_invalid: "This household invite is no longer valid for this account.",
};

export default async function SignupPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await getCurrentUser();
  if (user) {
    const auth = await getCurrentHousehold();
    redirect(auth ? "/dashboard" : "/no-household");
  }

  const params = await searchParams;
  const inviteToken = typeof params.invite === "string" ? params.invite : null;
  const errorKey = typeof params.error === "string" ? params.error : undefined;
  const initialError = errorKey ? (SIGNUP_ERRORS[errorKey] ?? "Sign up failed.") : null;
  const initialSuccessMessage =
    params.status === "verification_sent"
      ? "Check your email for a verification link to finish creating your account."
      : null;
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
              Create account
            </h1>
            <p className="mt-1.5 text-sm text-slate-500">
              Track your family expenses together.
            </p>
          </div>
        </div>

        <SignupForm
          csrfToken={csrfToken}
          inviteToken={inviteToken}
          initialError={initialError}
          initialSuccessMessage={initialSuccessMessage}
        />

        <p className="text-center text-xs text-slate-400">
          Self-hosted &middot; Private &middot; Family-first
        </p>
      </div>
    </div>
  );
}
