"use client";

import { useState, useTransition } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import type { HouseholdOption } from "@/lib/auth/session";

type HouseholdSwitcherProps = {
  currentHouseholdId: string;
  households: HouseholdOption[];
};

export function HouseholdSwitcher({
  currentHouseholdId,
  households,
}: HouseholdSwitcherProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const switchHousehold = (householdId: string) => {
    if (householdId === currentHouseholdId) return;

    startTransition(() => {
      void (async () => {
        setError(null);
        const response = await csrfFetch("/api/households", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ householdId }),
        });
        const data = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;

        if (!response.ok) {
          setError(data?.error?.message ?? "Unable to switch household.");
          return;
        }

        window.location.assign("/dashboard");
      })();
    });
  };

  if (households.length === 1) {
    return (
      <p className="max-w-40 truncate text-xs font-medium text-slate-600">
        {households[0]!.name}
      </p>
    );
  }

  return (
    <div>
      <label className="sr-only" htmlFor="household-switcher">
        Current household
      </label>
      <select
        className="max-w-40 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 sm:max-w-48"
        disabled={isPending}
        id="household-switcher"
        onChange={(event) => switchHousehold(event.target.value)}
        value={currentHouseholdId}
      >
        {households.map((household) => (
          <option key={household.id} value={household.id}>
            {household.name}
          </option>
        ))}
      </select>
      {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
