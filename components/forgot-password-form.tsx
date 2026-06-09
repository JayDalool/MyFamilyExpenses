"use client";

import type { FormEvent } from "react";
import { useState, useTransition } from "react";
import Link from "next/link";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { CSRF_FORM_FIELD_NAME } from "@/lib/auth/csrf";

const GENERIC_SUCCESS =
  "If an account exists for that email, a password reset link has been sent.";

type ForgotPasswordFormProps = {
  csrfToken: string;
  initialStatus?: "sent" | null;
  initialError?: string | null;
};

export function ForgotPasswordForm({
  csrfToken,
  initialStatus = null,
  initialError = null,
}: ForgotPasswordFormProps) {
  const [status, setStatus] = useState<"sent" | null>(initialStatus);
  const [error, setError] = useState<string | null>(initialError);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = { email: String(formData.get("email") ?? "") };

    startTransition(() => {
      void (async () => {
        setError(null);
        setStatus(null);
        setPreviewUrl(null);

        const response = await csrfFetch("/api/auth/forgot-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const json = (await response.json().catch(() => null)) as
          | { data?: { message?: string; previewUrl?: string }; error?: { message?: string } }
          | null;

        if (!response.ok) {
          setError(json?.error?.message ?? "Request failed. Please try again.");
          return;
        }

        setStatus("sent");
        setPreviewUrl(json?.data?.previewUrl ?? null);
      })();
    });
  };

  if (status === "sent") {
    return (
      <div className="space-y-5 rounded-3xl bg-white p-7 shadow-soft">
        <div className="rounded-2xl bg-emerald-50 px-4 py-4">
          <p className="text-sm font-medium text-emerald-800">{GENERIC_SUCCESS}</p>
          {previewUrl ? (
            <a
              className="mt-2 inline-flex text-sm font-medium text-emerald-800 underline underline-offset-4 hover:text-emerald-900"
              href={previewUrl}
            >
              Open the local reset link
            </a>
          ) : null}
        </div>
        <p className="text-center text-sm text-slate-500">
          Back to{" "}
          <Link className="font-medium text-brand-600 hover:underline" href="/auth/login">
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form
      action="/api/auth/forgot-password"
      className="space-y-5 rounded-3xl bg-white p-7 shadow-soft"
      method="post"
      onSubmit={handleSubmit}
    >
      <input name={CSRF_FORM_FIELD_NAME} type="hidden" value={csrfToken} />

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
          required
          type="email"
        />
      </div>

      {error ? (
        <div className="flex items-start gap-3 rounded-2xl bg-rose-50 px-4 py-3">
          <p className="text-sm text-rose-700">{error}</p>
        </div>
      ) : null}

      <button
        className="w-full rounded-2xl bg-brand-600 px-4 py-4 text-base font-semibold text-white shadow-sm transition hover:bg-brand-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isPending}
        type="submit"
      >
        {isPending ? "Sending..." : "Send reset link"}
      </button>

      <p className="text-center text-sm text-slate-500">
        Remembered your password?{" "}
        <Link className="font-medium text-brand-600 hover:underline" href="/auth/login">
          Sign in
        </Link>
      </p>
    </form>
  );
}
