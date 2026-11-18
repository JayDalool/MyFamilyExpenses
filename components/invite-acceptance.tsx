"use client";

import { useState, useTransition } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { Alert, Button } from "@/components/ui";
import { LogoutButton } from "@/components/logout-button";

export function InviteAcceptance({ token, accountant }: { token: string; accountant: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [verifyEmail, setVerifyEmail] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      {error ? <Alert variant="danger">{error}</Alert> : null}
      {verifyEmail && <LogoutButton resetPassword />}
      <Button
        className="w-full"
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            try {
              setError(null);
              setVerifyEmail(false);
              const response = await csrfFetch(`/api/invites/${encodeURIComponent(token)}`, {
                method: "POST",
              });
              const data = (await response.json().catch(() => null)) as
                | { data?: { redirectTo?: string }; error?: { message?: string; code?: string } }
                | null;
              if (!response.ok) {
                setError(data?.error?.message ?? "Unable to accept this invite.");
                setVerifyEmail(data?.error?.code === "email_unverified");
                return;
              }
              window.location.assign(data?.data?.redirectTo ?? "/dashboard");
            } catch {
              setError("Could not reach the app. Try accepting again.");
            }
          });
        }}
        type="button"
      >
        {isPending ? "Accepting…" : accountant ? "Accept accountant invitation" : "Join household"}
      </Button>
    </div>
  );
}
