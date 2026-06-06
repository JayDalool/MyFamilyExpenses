"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/auth/csrf-client";

export function LogoutButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleLogout = () => {
    startTransition(() => {
      void (async () => {
        setError(null);

        try {
          const response = await csrfFetch("/api/auth/logout", {
            method: "POST",
          });

          if (!response.ok) {
            const data = (await response.json().catch(() => null)) as
              | { error?: { message?: string } }
              | null;
            setError(data?.error?.message ?? "Unable to sign out. Please try again.");
            return;
          }

          router.push("/auth/login");
          router.refresh();
        } catch {
          setError("Unable to sign out. Check your connection and try again.");
        }
      })();
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isPending}
        onClick={handleLogout}
        type="button"
      >
        {isPending ? "Signing out..." : "Logout"}
      </button>
      {error ? <p className="max-w-56 text-right text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
