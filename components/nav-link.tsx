"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type NavLinkProps = {
  href: string;
  children: ReactNode;
  /** Base classes applied always. */
  className: string;
  /** Extra classes when the current route is under `href`. */
  activeClassName: string;
  /** Extra classes when it is not. */
  inactiveClassName: string;
};

/**
 * Link that highlights itself when the current route matches (exact or a
 * sub-route, so /expenses/123 keeps the Expenses tab lit). Presentation-only:
 * all hrefs stay in the server shell (components/app-shell.tsx).
 */
export function NavLink({
  href,
  children,
  className,
  activeClassName,
  inactiveClassName,
}: NavLinkProps) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      aria-current={isActive ? "page" : undefined}
      className={`${className} ${isActive ? activeClassName : inactiveClassName}`}
      href={href}
    >
      {children}
    </Link>
  );
}
