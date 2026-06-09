import Link from "next/link";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TableHTMLAttributes,
} from "react";

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

const buttonVariants = {
  primary: "border-brand-600 bg-brand-600 text-white hover:bg-brand-700",
  secondary: "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
  danger: "border-rose-200 bg-white text-rose-700 hover:bg-rose-50",
  ghost: "border-transparent bg-transparent text-slate-600 hover:bg-slate-100",
} as const;

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonVariants }) {
  return (
    <button
      className={classes(
        "inline-flex min-h-10 items-center justify-center rounded-lg border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        buttonVariants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function ButtonLink({
  children,
  className,
  href,
  variant = "primary",
}: {
  children: ReactNode;
  className?: string;
  href: string;
  variant?: keyof typeof buttonVariants;
}) {
  return (
    <Link
      className={classes(
        "inline-flex min-h-10 items-center justify-center rounded-lg border px-4 py-2 text-sm font-semibold transition",
        buttonVariants[variant],
        className,
      )}
      href={href}
    >
      {children}
    </Link>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={classes("rounded-lg border border-slate-200 bg-white p-5 shadow-sm", className)}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={classes(
        "min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={classes(
        "min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100",
        className,
      )}
      {...props}
    />
  );
}

const badgeVariants = {
  neutral: "bg-slate-100 text-slate-700",
  success: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-rose-100 text-rose-800",
  brand: "bg-brand-100 text-brand-700",
} as const;

export function Badge({
  children,
  variant = "neutral",
}: {
  children: ReactNode;
  variant?: keyof typeof badgeVariants;
}) {
  return (
    <span className={classes("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", badgeVariants[variant])}>
      {children}
    </span>
  );
}

const alertVariants = {
  info: "border-slate-200 bg-slate-50 text-slate-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-rose-200 bg-rose-50 text-rose-800",
} as const;

export function Alert({
  children,
  variant = "info",
}: {
  children: ReactNode;
  variant?: keyof typeof alertVariants;
}) {
  return (
    <div className={classes("rounded-lg border px-4 py-3 text-sm", alertVariants[variant])}>
      {children}
    </div>
  );
}

export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={classes("w-full border-collapse text-left text-sm", className)} {...props} />
    </div>
  );
}

export function Pagination({
  currentPage,
  totalPages,
  previousHref,
  nextHref,
}: {
  currentPage: number;
  totalPages: number;
  previousHref?: string;
  nextHref?: string;
}) {
  return (
    <nav className="flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
      {previousHref ? <ButtonLink href={previousHref} variant="secondary">Previous</ButtonLink> : <span />}
      <p className="text-sm text-slate-500">Page {currentPage} of {totalPages}</p>
      {nextHref ? <ButtonLink href={nextHref} variant="secondary">Next</ButtonLink> : <span />}
    </nav>
  );
}
