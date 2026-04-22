import Link from "next/link";
import type { ReactNode } from "react";
import type { CurrentUser } from "@/lib/auth/session";
import { LogoutButton } from "@/components/logout-button";

type AppShellProps = {
  user: CurrentUser;
  children: ReactNode;
};

export function AppShell({ user, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link className="text-xl font-semibold text-slate-900" href="/dashboard">
              MyFamilyExpenses
            </Link>
            <p className="text-sm text-slate-500">
              Welcome back, {user.name}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200" href="/dashboard">
              Dashboard
            </Link>
            <Link className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200" href="/expenses">
              Expenses
            </Link>
            {user.role === "ADMIN" ? (
              <Link className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200" href="/categories">
                Categories
              </Link>
            ) : null}
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
