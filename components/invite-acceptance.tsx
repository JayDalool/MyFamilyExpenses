"use client";

import { useState, useTransition } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { Alert, Button } from "@/components/ui";

export function InviteAcceptance({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      {error ? <Alert variant="danger">{error}</Alert> : null}
      <Button
        className="w-full"
        disabled={isPending}
        onClick={() => {
          startTransition(() => {
            void (async () => {
              setError(null);
              const response = await csrfFetch(`/api/invites/${encodeURIComponent(token)}`, {
                method: "POST",
              });
              const data = (await response.json().catch(() => null)) as
                | { error?: { message?: string } }
                | null;
              if (!response.ok) {
                setError(data?.error?.message ?? "Unable to accept this invite.");
                return;
              }
              window.location.assign("/dashboard");
            })();
          });
        }}
        type="button"
      >
        {isPending ? "Joining household..." : "Join household"}
      </Button>
    </div>
  );
}
