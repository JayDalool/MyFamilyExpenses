"use client";

import type { FormEvent } from "react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { CSRF_FORM_FIELD_NAME } from "@/lib/auth/csrf";

type SignupFormProps = {
  csrfToken: string;
  inviteToken?: string | null;
  initialError?: string | null;
  initialSuccessMessage?: string | null;
};

export function SignupForm({
  csrfToken,
  inviteToken = null,
  initialError = null,
  initialSuccessMessage = null,
}: SignupFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(initialError);
  const [successMessage, setSuccessMessage] = useState<string | null>(initialSuccessMessage);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = {
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      confirmPassword: String(formData.get("confirmPassword") ?? ""),
      ...(inviteToken ? { inviteToken } : {}),
    };

    startTransition(() => {
      void (async () => {
        setError(null);
        setSuccessMessage(null);
        setPreviewUrl(null);

        const response = await csrfFetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          setError(data?.error?.message ?? "Sign up failed. Please try again.");
          return;
        }

        const data = (await response.json().catch(() => null)) as
          | { data?: { message?: string; previewUrl?: string } }
          | null;

        setSuccessMessage(
          data?.data?.message ?? "Check your email for a verification link to finish creating your account.",
        );
        setPreviewUrl(data?.data?.previewUrl ?? null);
        router.refresh();
      })();
    });
  };

  if (successMessage) {
    return (
      <div className="space-y-5 rounded-3xl bg-white p-7 shadow-soft">
        <div className="flex items-start gap-3 rounded-2xl bg-emerald-50 px-4 py-4">
          <svg
            className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
          <div className="space-y-2">
            <p className="text-sm font-medium text-emerald-800">{successMessage}</p>
            <p className="text-sm text-emerald-700">
              Once you verify your email, you&apos;ll be signed in automatically and taken to
              your dashboard.
            </p>
            {previewUrl ? (
              <a
                className="inline-flex text-sm font-medium text-emerald-800 underline underline-offset-4 hover:text-emerald-900"
                href={previewUrl}
              >
                Open the local verification link
              </a>
            ) : null}
          </div>
        </div>

        <p className="text-center text-sm text-slate-500">
          Already verified?{" "}
          <Link
            className="font-medium text-brand-600 hover:underline"
            href={inviteToken ? `/auth/login?invite=${encodeURIComponent(inviteToken)}` : "/auth/login"}
          >
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form
      action="/api/auth/signup"
      className="space-y-5 rounded-3xl bg-white p-7 shadow-soft"
      method="post"
      onSubmit={handleSubmit}
    >
      <input name={CSRF_FORM_FIELD_NAME} type="hidden" value={csrfToken} />
      {inviteToken ? <input name="inviteToken" type="hidden" value={inviteToken} /> : null}
      <div className="space-y-1">
        <label className="block text-sm font-semibold text-slate-700" htmlFor="name">
          Full name
        </label>
        <input
          autoComplete="name"
          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:bg-white"
          id="name"
          name="name"
          placeholder="Your name"
          type="text"
        />
      </div>

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
          autoComplete="new-password"
          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:bg-white"
          id="password"
          minLength={8}
          name="password"
          placeholder="At least 8 characters"
          type="password"
        />
      </div>

      <div className="space-y-1">
        <label className="block text-sm font-semibold text-slate-700" htmlFor="confirmPassword">
          Confirm password
        </label>
        <input
          autoComplete="new-password"
          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:bg-white"
          id="confirmPassword"
          name="confirmPassword"
          placeholder="Repeat your password"
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

      <button
        className="w-full rounded-2xl bg-brand-600 px-4 py-4 text-base font-semibold text-white shadow-sm transition hover:bg-brand-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isPending}
        type="submit"
      >
        {isPending ? "Creating account..." : "Create account"}
      </button>

      <p className="text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link
          className="font-medium text-brand-600 hover:underline"
          href={inviteToken ? `/auth/login?invite=${encodeURIComponent(inviteToken)}` : "/auth/login"}
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
