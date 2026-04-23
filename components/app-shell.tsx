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
      {/* ── Desktop header ──────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link className="flex items-center gap-2.5" href="/dashboard">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-600">
              <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z"
                />
              </svg>
            </div>
            <span className="font-semibold text-slate-900">MyFamilyExpenses</span>
          </Link>

          <div className="hidden items-center gap-1 sm:flex">
            <Link
              className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              href="/dashboard"
            >
              Dashboard
            </Link>
            <Link
              className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              href="/expenses"
            >
              Expenses
            </Link>
            {user.role === "ADMIN" ? (
              <Link
                className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                href="/categories"
              >
                Categories
              </Link>
            ) : null}
            <div className="ml-2 border-l border-slate-200 pl-3">
              <p className="text-xs text-slate-500">{user.name}</p>
            </div>
            <LogoutButton />
          </div>

          {/* Mobile: user name only in header */}
          <div className="flex items-center gap-2 sm:hidden">
            <span className="text-xs text-slate-500">{user.name}</span>
            <LogoutButton />
          </div>
        </div>
      </header>

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-6xl px-4 py-6 pb-28 sm:pb-8">{children}</main>

      {/* ── Mobile bottom navigation ─────────────────────────────────────────── */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white sm:hidden">
        <div className={`grid ${user.role === "ADMIN" ? "grid-cols-3" : "grid-cols-2"}`}>
          <Link
            href="/dashboard"
            className="flex flex-col items-center gap-1 py-3 text-slate-500 transition hover:text-brand-600"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
              />
            </svg>
            <span className="text-xs font-medium">Home</span>
          </Link>

          <Link
            href="/expenses"
            className="flex flex-col items-center gap-1 py-3 text-slate-500 transition hover:text-brand-600"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z"
              />
            </svg>
            <span className="text-xs font-medium">Expenses</span>
          </Link>

          {user.role === "ADMIN" ? (
            <Link
              href="/categories"
              className="flex flex-col items-center gap-1 py-3 text-slate-500 transition hover:text-brand-600"
            >
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                />
              </svg>
              <span className="text-xs font-medium">Categories</span>
            </Link>
          ) : null}
        </div>
      </nav>
    </div>
  );
}
