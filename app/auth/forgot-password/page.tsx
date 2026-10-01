import { redirect } from "next/navigation";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { getCurrentHousehold, getCurrentUser } from "@/lib/auth/session";
import { getRequestCsrfToken } from "@/lib/auth/csrf-server";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const FORGOT_ERRORS: Record<string, string> = {
  invalid: "Enter a valid email address.",
  rate_limited: "Too many requests. Please try again later.",
  unavailable: "Password reset is temporarily unavailable. Please try again later.",
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await getCurrentUser();
  if (user) {
    const auth = await getCurrentHousehold();
    redirect(auth ? "/dashboard" : "/no-household");
  }

  const params = await searchParams;
  const errorKey = typeof params.error === "string" ? params.error : undefined;
  const statusKey = typeof params.status === "string" ? params.status : undefined;
  const initialError = errorKey ? (FORGOT_ERRORS[errorKey] ?? "Request failed.") : null;
  const initialStatus = statusKey === "sent" ? "sent" : null;
  const csrfToken = await getRequestCsrfToken();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-brand-50 via-white to-slate-100 px-4 py-12">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Forgot your password?
            </h1>
            <p className="mt-1.5 text-sm text-slate-500">
              Enter your email and we&apos;ll send a reset link if an account exists.
            </p>
          </div>
        </div>

        <ForgotPasswordForm
          csrfToken={csrfToken}
          initialStatus={initialStatus}
          initialError={initialError}
        />

        <p className="text-center text-xs text-slate-400">
          Self-hosted &middot; Private &middot; Family-first
        </p>
      </div>
    </div>
  );
}
