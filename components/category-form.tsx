"use client";

import type { FormEvent } from "react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function CategoryForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload = {
      name: String(formData.get("name") ?? ""),
    };

    startTransition(() => {
      void (async () => {
        setError(null);
        setSuccess(null);

        const response = await fetch("/api/categories", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const data = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;

        if (!response.ok) {
          setError(data?.error?.message ?? "Unable to create category.");
          return;
        }

        form.reset();
        setSuccess("Category created.");
        router.refresh();
      })();
    });
  };

  return (
    <form className="space-y-3 rounded-3xl bg-white p-6 shadow-soft" onSubmit={handleSubmit}>
      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="name">
          New category
        </label>
        <input
          className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none transition focus:border-brand-500"
          id="name"
          name="name"
          placeholder="Groceries"
          type="text"
        />
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-700">{success}</p> : null}

      <button
        className="rounded-2xl bg-brand-600 px-4 py-3 font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isPending}
        type="submit"
      >
        {isPending ? "Saving..." : "Create category"}
      </button>
    </form>
  );
}
