"use client";

import { useEffect, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";

type Suggestion = { categoryId: string; count: number; total: number };

type Props = {
  /** Vendor typed by the user; empty means no lookup. */
  vendor: string;
  /** Only ACTIVE categories, as passed to the wizard. */
  categories: Array<{ id: string; name: string }>;
  currentCategoryId: string;
  onUse: (categoryId: string) => void;
};

export function CategorySuggestion({ vendor, categories, currentCategoryId, onUse }: Props) {
  const key = vendor.trim();
  const [result, setResult] = useState<{ key: string; suggestion: Suggestion | null } | null>(null);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await csrfFetch("/api/expenses/category-suggestion", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vendor: key }),
          signal: controller.signal,
        });
        if (!response.ok) {
          setResult({ key, suggestion: null });
          return;
        }
        const json = (await response.json()) as { data?: { suggestion: Suggestion | null } };
        setResult({ key, suggestion: json.data?.suggestion ?? null });
      } catch {
        // Aborted or offline: the suggestion is optional, so show nothing.
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);

  if (!key || !result || result.key !== key || !result.suggestion) return null;

  const { categoryId, count, total } = result.suggestion;
  const category = categories.find((item) => item.id === categoryId);
  if (!category || categoryId === currentCategoryId) return null;

  return (
    <div
      aria-live="polite"
      className="mt-2 flex flex-wrap items-center gap-2 rounded-2xl border border-brand-100 bg-brand-50 px-4 py-2 text-sm text-slate-700"
    >
      <span>
        Filed under <span className="font-semibold">{category.name}</span> {count} of {total}{" "}
        {total === 1 ? "time" : "times"} before
      </span>
      <button
        className="min-h-11 rounded-xl border border-brand-500 bg-white px-4 text-sm font-semibold text-brand-700 transition hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-100"
        onClick={() => onUse(categoryId)}
        type="button"
      >
        Use {category.name}
      </button>
    </div>
  );
}
