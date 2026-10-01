"use client";

import type { FormEvent } from "react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { CSRF_FORM_FIELD_NAME } from "@/lib/auth/csrf";

interface LoginFormProps {
  csrfToken: string;
  inviteToken?: string | null;
  googleEnabled?: boolean;
  microsoftEnabled?: boolean;
  oauthError?: string | null;
  initialSuccessMessage?: string | null;
}

export function LoginForm({
  csrfToken,
  inviteToken = null,
  googleEnabled = false,
  microsoftEnabled = false,
  oauthError,
  initialSuccessMessage = null,
}: LoginFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(oauthError ?? null);
  const [successMessage, setSuccessMessage] = useState<string | null>(initialSuccessMessage);
  const [isPending, startTransition] = useTransition();
  const showOAuth = googleEnabled || microsoftEnabled;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      ...(inviteToken ? { inviteToken } : {}),
    };

    startTransition(() => {
      void (async () => {
        setError(null);
        setSuccessMessage(null);

        const response = await csrfFetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          setError(data?.error?.message ?? "Login failed. Please try again.");
          return;
        }

        const data = (await response.json().catch(() => null)) as
          | { data?: { redirectTo?: string } }
          | null;
        router.push(data?.data?.redirectTo ?? "/dashboard");
        router.refresh();
      })();
    });
  };

  return (
    <div className="space-y-4">
      <form
        action="/api/auth/login"
        className="space-y-5 rounded-3xl bg-white p-7 shadow-soft"
        method="post"
        onSubmit={handleSubmit}
      >
        <input name={CSRF_FORM_FIELD_NAME} type="hidden" value={csrfToken} />
        {inviteToken ? <input name="inviteToken" type="hidden" value={inviteToken} /> : null}
        <div className="space-y-1">
          <label className="block text-sm font-semibold text-slate-700" htmlFor="email">
            Email address
          </label>
          <input
            autoComplete="email"
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:bg-white"
            id="email"
            name="email"
            placeholder="you@example.com"
            type="email"
          />
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-semibold text-slate-700" htmlFor="password">
            Password
          </label>
          <input
            autoComplete="current-password"
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:bg-white"
            id="password"
            name="password"
            placeholder="Enter your password"
            type="password"
          />
        </div>

        {error ? (
          <div className="flex items-start gap-3 rounded-2xl bg-rose-50 px-4 py-3">
            <svg
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-sm text-rose-700">{error}</p>
          </div>
        ) : null}

        {successMessage ? (
          <div className="rounded-2xl bg-emerald-50 px-4 py-3">
            <p className="text-sm font-medium text-emerald-800">{successMessage}</p>
          </div>
        ) : null}

        <div className="text-right">
          <Link
            className="text-sm font-medium text-brand-600 hover:underline"
            href="/auth/forgot-password"
          >
            Forgot password?
          </Link>
        </div>

        <button
          className="w-full rounded-2xl bg-brand-600 px-4 py-4 text-base font-semibold text-white shadow-sm transition hover:bg-brand-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isPending}
          type="submit"
        >
          {isPending ? "Signing in..." : "Sign in"}
        </button>

        <p className="text-center text-sm text-slate-500">
          {"Don't have an account? "}
          <Link
            className="font-medium text-brand-600 hover:underline"
            href={inviteToken ? `/auth/signup?invite=${encodeURIComponent(inviteToken)}` : "/auth/signup"}
          >
            Sign up
          </Link>
        </p>
      </form>

      {showOAuth && (
        <div className="rounded-3xl bg-white p-7 shadow-soft">
          <div className="relative mb-5">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-3 text-slate-400">or continue with</span>
            </div>
          </div>

          <div className="space-y-3">
            {googleEnabled && (
              <a
                className="flex w-full items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-95"
                href={inviteToken ? `/api/auth/oauth/google/start?invite=${encodeURIComponent(inviteToken)}` : "/api/auth/oauth/google/start"}
              >
                <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                Continue with Google
              </a>
            )}

            {microsoftEnabled && (
              <a
                className="flex w-full items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-95"
                href={inviteToken ? `/api/auth/oauth/microsoft/start?invite=${encodeURIComponent(inviteToken)}` : "/api/auth/oauth/microsoft/start"}
              >
                <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24">
                  <path d="M11.4 24H0V12.6h11.4V24z" fill="#F25022" />
                  <path d="M24 24H12.6V12.6H24V24z" fill="#00A4EF" />
                  <path d="M11.4 11.4H0V0h11.4v11.4z" fill="#7FBA00" />
                  <path d="M24 11.4H12.6V0H24v11.4z" fill="#FFB900" />
                </svg>
                Continue with Microsoft
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
