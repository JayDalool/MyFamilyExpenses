"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/auth/csrf-client";

type CategoryActionsProps = {
  category: {
    id: string;
    name: string;
    status: "ACTIVE" | "DISABLED";
  };
};

export function CategoryActions({ category }: CategoryActionsProps) {
  const router = useRouter();
  const [name, setName] = useState(category.name);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const mutate = (method: "PATCH" | "DELETE", body?: Record<string, unknown>) => {
    startTransition(() => {
      void (async () => {
        setError(null);
        const response = await csrfFetch(`/api/categories/${category.id}`, {
          method,
          ...(body
            ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
            : {}),
        });
        const data = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;

        if (!response.ok) {
          setError(data?.error?.message ?? "Unable to update category.");
          return;
        }

        router.refresh();
      })();
    });
  };

  return (
    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
      <label className="sr-only" htmlFor={`category-name-${category.id}`}>
        Category name
      </label>
      <input
        className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
        id={`category-name-${category.id}`}
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
        value={name}
      />
      <button
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
        disabled={isPending || name.trim() === category.name}
        onClick={() => mutate("PATCH", { name })}
        type="button"
      >
        Save name
      </button>
      <button
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
        disabled={isPending}
        onClick={() =>
          mutate("PATCH", { status: category.status === "ACTIVE" ? "DISABLED" : "ACTIVE" })
        }
        type="button"
      >
        {category.status === "ACTIVE" ? "Disable" : "Enable"}
      </button>
      <button
        className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50"
        disabled={isPending}
        onClick={() => mutate("DELETE")}
        type="button"
      >
        Delete
      </button>
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
    </div>
  );
}
