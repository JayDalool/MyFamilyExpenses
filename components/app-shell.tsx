/* eslint-disable @next/next/no-img-element -- brand SVGs are static assets; no optimization needed */
import Link from "next/link";
import type { ReactNode } from "react";
import type { AuthContext } from "@/lib/auth/session";
import { LogoutButton } from "@/components/logout-button";
import { HouseholdSwitcher } from "@/components/household-switcher";
import { NavLink } from "@/components/nav-link";

type AppShellProps = {
  auth: AuthContext;
  children: ReactNode;
};

const DESKTOP_LINK =
  "rounded-full px-4 py-2 text-sm font-medium transition";
const DESKTOP_ACTIVE = "bg-brand-50 text-brand-700";
const DESKTOP_INACTIVE = "text-slate-600 hover:bg-slate-100 hover:text-slate-900";

const TAB_LINK = "flex min-h-[3.5rem] flex-col items-center justify-center gap-1 py-2 transition";
const TAB_ACTIVE = "text-brand-600";
const TAB_INACTIVE = "text-slate-500 hover:text-brand-600";

function TabIcon({ d }: { d: string }) {
  return (
    <svg aria-hidden className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={d} />
    </svg>
  );
}

export function AppShell({ auth, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-slate-100">
      {/* pt-[env(...)] keeps the header clear of the iPhone notch in standalone
          (Add to Home Screen) mode; px-[max(...)] handles landscape rounded corners. */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-[max(1rem,env(safe-area-inset-left))] py-3 pr-[max(1rem,env(safe-area-inset-right))]">
          <Link className="flex min-w-0 items-center gap-2.5" href="/dashboard">
            {/* Brand mark: swap public/brand/logo-mark.svg to change everywhere. */}
            <img
              alt=""
              className="h-8 w-8 flex-shrink-0 rounded-[22%]"
              height={32}
              src="/brand/logo-mark.svg"
              width={32}
            />
            <span className="truncate font-semibold text-slate-900">My Expenses</span>
          </Link>

          <div className="hidden items-center gap-1 sm:flex">
            <NavLink
              activeClassName={DESKTOP_ACTIVE}
              className={DESKTOP_LINK}
              href="/dashboard"
              inactiveClassName={DESKTOP_INACTIVE}
            >
              Dashboard
            </NavLink>
            <NavLink
              activeClassName={DESKTOP_ACTIVE}
              className={DESKTOP_LINK}
              href="/expenses"
              inactiveClassName={DESKTOP_INACTIVE}
            >
              Expenses
            </NavLink>
            <NavLink
              activeClassName={DESKTOP_ACTIVE}
              className={DESKTOP_LINK}
              href="/reports"
              inactiveClassName={DESKTOP_INACTIVE}
            >
              Reports
            </NavLink>
            <NavLink
              activeClassName={DESKTOP_ACTIVE}
              className={DESKTOP_LINK}
              href="/categories"
              inactiveClassName={DESKTOP_INACTIVE}
            >
              Categories
            </NavLink>
            <NavLink
              activeClassName={DESKTOP_ACTIVE}
              className={DESKTOP_LINK}
              href="/household"
              inactiveClassName={DESKTOP_INACTIVE}
            >
              Household
            </NavLink>
            <div className="ml-2 border-l border-slate-200 pl-3">
              <HouseholdSwitcher
                currentHouseholdId={auth.householdId}
                households={auth.households}
              />
              <p className="text-xs text-slate-500">
                {auth.user.name} | {auth.householdRole}
              </p>
            </div>
            <LogoutButton />
          </div>

          <div className="flex flex-shrink-0 items-center gap-2 sm:hidden">
            <HouseholdSwitcher
              currentHouseholdId={auth.householdId}
              households={auth.households}
            />
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-[max(1rem,env(safe-area-inset-left))] py-6 pb-32 pr-[max(1rem,env(safe-area-inset-right))] sm:pb-8">
        {children}
      </main>

      {/* Mobile tab bar. pb-[env(...)] keeps taps clear of the iPhone home indicator. */}
      <nav
        aria-label="Primary"
        className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        <div className="grid grid-cols-5">
          <NavLink
            activeClassName={TAB_ACTIVE}
            className={TAB_LINK}
            href="/dashboard"
            inactiveClassName={TAB_INACTIVE}
          >
            <TabIcon d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            <span className="text-xs font-medium">Home</span>
          </NavLink>

          <NavLink
            activeClassName={TAB_ACTIVE}
            className={TAB_LINK}
            href="/expenses"
            inactiveClassName={TAB_INACTIVE}
          >
            <TabIcon d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
            <span className="text-xs font-medium">Expenses</span>
          </NavLink>

          <NavLink
            activeClassName={TAB_ACTIVE}
            className={TAB_LINK}
            href="/reports"
            inactiveClassName={TAB_INACTIVE}
          >
            <TabIcon d="M9 17v-6m6 6V7m4 14H5a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2z" />
            <span className="text-xs font-medium">Reports</span>
          </NavLink>

          <NavLink
            activeClassName={TAB_ACTIVE}
            className={TAB_LINK}
            href="/categories"
            inactiveClassName={TAB_INACTIVE}
          >
            <TabIcon d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            <span className="text-[11px] font-medium">Categories</span>
          </NavLink>

          <NavLink
            activeClassName={TAB_ACTIVE}
            className={TAB_LINK}
            href="/household"
            inactiveClassName={TAB_INACTIVE}
          >
            <TabIcon d="M17 20h5v-2a4 4 0 00-4-4h-1m-10 6H2v-2a4 4 0 014-4h1m5 6v-2a4 4 0 00-4-4H6m6 6h5v-2a4 4 0 00-4-4h-1m1-7a3 3 0 11-6 0 3 3 0 016 0zm6 2a2.5 2.5 0 10-3.5-2.3" />
            <span className="text-[11px] font-medium">Household</span>
          </NavLink>
        </div>
      </nav>
    </div>
  );
}
