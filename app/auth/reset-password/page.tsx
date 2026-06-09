import Link from "next/link";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { getRequestCsrfToken } from "@/lib/auth/csrf-server";
import { findValidPasswordResetTokenByRaw } from "@/lib/auth/password-reset";
import { resetPasswordTokenSchema } from "@/lib/validation/auth";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const GENERIC_INVALID =
  "This password reset link is invalid or has expired. Request a new one.";

const RESET_ERRORS: Record<string, string> = {
  invalid: GENERIC_INVALID,
  password: "Password must be at least 8 characters and match the confirmation.",
  rate_limited: "Too many attempts. Please try again later.",
};

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const rawToken = typeof params.token === "string" ? params.token : "";
  const tokenParsed = resetPasswordTokenSchema.safeParse(rawToken);
  const errorKey = typeof params.error === "string" ? params.error : undefined;
  const initialError = errorKey ? (RESET_ERRORS[errorKey] ?? GENERIC_INVALID) : null;

  // Server-side token validation. We never tell the client which user the
  // token belongs to, and the generic message is identical for every failure
  // mode (invalid format, not found, expired, already used).
  const tokenIsAcceptable =
    tokenParsed.success && (await findValidPasswordResetTokenByRaw(tokenParsed.data));

  const csrfToken = await getRequestCsrfToken();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-brand-50 via-white to-slate-100 px-4 py-12">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Set a new password
            </h1>
            <p className="mt-1.5 text-sm text-slate-500">
              Pick a strong password you have not used here before.
            </p>
          </div>
        </div>

        {tokenIsAcceptable ? (
          <ResetPasswordForm
            csrfToken={csrfToken}
            token={tokenParsed.data}
            initialError={initialError}
          />
        ) : (
          <div className="space-y-5 rounded-3xl bg-white p-7 shadow-soft">
            <div className="rounded-2xl bg-rose-50 px-4 py-4">
              <p className="text-sm font-medium text-rose-700">{GENERIC_INVALID}</p>
            </div>
            <p className="text-center text-sm text-slate-500">
              <Link
                className="font-medium text-brand-600 hover:underline"
                href="/auth/forgot-password"
              >
                Request a new reset link
              </Link>
            </p>
          </div>
        )}

        <p className="text-center text-xs text-slate-400">
          Self-hosted &middot; Private &middot; Family-first
        </p>
      </div>
    </div>
  );
}
