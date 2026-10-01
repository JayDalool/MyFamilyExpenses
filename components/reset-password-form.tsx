"use client";

import type { FormEvent } from "react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { CSRF_FORM_FIELD_NAME } from "@/lib/auth/csrf";

type ResetPasswordFormProps = {
  csrfToken: string;
  token: string;
  initialError?: string | null;
};

export function ResetPasswordForm({
  csrfToken,
  token,
  initialError = null,
}: ResetPasswordFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(initialError);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = {
      token,
      password: String(formData.get("password") ?? ""),
      confirmPassword: String(formData.get("confirmPassword") ?? ""),
    };

    startTransition(() => {
      void (async () => {
        setError(null);

        const response = await csrfFetch("/api/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const json = (await response.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          setError(json?.error?.message ?? "Reset failed. Please try again.");
          return;
        }

        router.push("/auth/login?status=password_reset");
        router.refresh();
      })();
    });
  };

  return (
    <form
      action="/api/auth/reset-password"
      className="space-y-5 rounded-3xl bg-white p-7 shadow-soft"
      method="post"
      onSubmit={handleSubmit}
    >
      <input name={CSRF_FORM_FIELD_NAME} type="hidden" value={csrfToken} />
      <input name="token" type="hidden" value={token} />

      <div className="space-y-1">
        <label className="block text-sm font-semibold text-slate-700" htmlFor="password">
          New password
        </label>
        <input
          autoComplete="new-password"
          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:bg-white"
          id="password"
          minLength={8}
          name="password"
          placeholder="At least 8 characters"
          required
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
          minLength={8}
          name="confirmPassword"
          placeholder="Repeat your new password"
          required
          type="password"
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
        {isPending ? "Updating..." : "Update password"}
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
