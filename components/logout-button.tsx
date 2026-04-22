"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleLogout = () => {
    startTransition(() => {
      void (async () => {
        await fetch("/api/auth/logout", {
          method: "POST",
        });

        router.push("/auth/login");
        router.refresh();
      })();
    });
  };

  return (
    <button
      className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={isPending}
      onClick={handleLogout}
      type="button"
    >
      {isPending ? "Signing out..." : "Logout"}
    </button>
  );
}
