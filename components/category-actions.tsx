"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { Button } from "@/components/ui";

type CategoryActionsProps = {
  category: {
    id: string;
    name: string;
    status: "ACTIVE" | "DISABLED";
  };
};

export function CategoryActions({ category }: CategoryActionsProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const mutate = (
    method: "PATCH" | "DELETE",
    body?: Record<string, unknown>,
    onSuccess?: () => void,
  ) => {
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

        onSuccess?.();
        router.refresh();
      })();
    });
  };

  const cancelEdit = () => {
    setName(category.name);
    setError(null);
    setIsEditing(false);
  };

  const handleDelete = () => {
    if (
      !window.confirm(
        "Remove this category? Categories already used by expenses will be disabled instead of deleted.",
      )
    ) {
      return;
    }
    mutate("DELETE");
  };

  if (isEditing) {
    return (
      <div className="w-full sm:w-auto">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            mutate("PATCH", { name }, () => setIsEditing(false));
          }}
        >
          <label className="sr-only" htmlFor={`category-name-${category.id}`}>
            Category name
          </label>
          <input
            autoFocus
            className="min-h-10 w-full min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 sm:w-56 sm:flex-none"
            id={`category-name-${category.id}`}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
          <Button
            disabled={isPending || name.trim() === "" || name.trim() === category.name}
            type="submit"
          >
            Save
          </Button>
          <Button disabled={isPending} onClick={cancelEdit} type="button" variant="ghost">
            Cancel
          </Button>
        </form>
        {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="w-full sm:w-auto">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={isPending}
          onClick={() => setIsEditing(true)}
          type="button"
          variant="secondary"
        >
          Edit
        </Button>
        <Button
          disabled={isPending}
          onClick={() =>
            mutate("PATCH", { status: category.status === "ACTIVE" ? "DISABLED" : "ACTIVE" })
          }
          type="button"
          variant="ghost"
        >
          {category.status === "ACTIVE" ? "Disable" : "Enable"}
        </Button>
        <Button disabled={isPending} onClick={handleDelete} type="button" variant="danger">
          Delete
        </Button>
      </div>
      {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
    </div>
  );
}
