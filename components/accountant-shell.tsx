/* eslint-disable @next/next/no-img-element -- the brand mark is a static SVG */
import Link from "next/link";
import type { ReactNode } from "react";
import { LogoutButton } from "@/components/logout-button";

export function AccountantShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link className="flex items-center gap-2.5 font-semibold text-slate-900" href="/clients">
            <img alt="" className="h-8 w-8 rounded-[22%]" height={32} src="/brand/logo-mark.svg" width={32} />
            My Expenses
          </Link>
          <nav aria-label="Accountant" className="flex flex-wrap items-center gap-3 text-sm">
            <Link className="font-semibold text-brand-700 hover:underline" href="/clients">Clients</Link>
            <Link className="font-medium text-slate-600 hover:underline" href="/dashboard">Dashboard</Link>
            <LogoutButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}
