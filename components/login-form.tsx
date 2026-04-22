"use client";

import type { FormEvent } from "react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
    };

    startTransition(() => {
      void (async () => {
        setError(null);

        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;

          setError(data?.error?.message ?? "Login failed. Please try again.");
          return;
        }

        router.push("/dashboard");
        router.refresh();
      })();
    });
  };

  return (
    <form
      className="space-y-4 rounded-3xl bg-white p-6 shadow-soft"
      onSubmit={handleSubmit}
    >
      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="email">
          Email
        </label>
        <input
          className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-brand-500"
          id="email"
          name="email"
          placeholder="admin@example.com"
          type="email"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="password">
          Password
        </label>
        <input
          className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-brand-500"
          id="password"
          name="password"
          placeholder="Enter your password"
          type="password"
        />
      </div>

      {error ? (
        <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
      ) : null}

      <button
        className="w-full rounded-2xl bg-brand-600 px-4 py-3 text-base font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isPending}
        type="submit"
      >
        {isPending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
