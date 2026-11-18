"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Card, Input } from "@/components/ui";
import { csrfFetch } from "@/lib/auth/csrf-client";

type Invitation = {
  id: string;
  email: string;
  status: "Accepted" | "Revoked" | "Expired" | "Sending" | "Delivery failed" | "Sent" | "Link created";
  expiresOn: string;
};

export function AccountantInvitations({
  householdId,
  invites,
}: {
  householdId: string;
  invites: Invitation[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();
  const endpoint = "/api/household/invites";

  function submit(request: Promise<Response>, success: string, clearEmail = false) {
    setFeedback(null);
    startTransition(async () => {
      try {
        const response = await request;
        const payload = await response.json().catch(() => null);
        if (response.ok) {
          setFeedback({ message: success });
          if (clearEmail) setEmail("");
        } else {
          setFeedback({ message: payload?.error?.message ?? "The invitation could not be updated.", error: true });
        }
      } catch {
        setFeedback({ message: "Could not reach the app. Check your connection and try again.", error: true });
      } finally {
        router.refresh();
      }
    });
  }

  function send(address: string, isResend = false) {
    if (isResend && !window.confirm(`Send a new invitation to ${address}? The previous link will expire.`)) return;
    submit(csrfFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: address, householdId, role: "ACCOUNTANT", expiresInDays: 7, maxUses: 1 }),
    }), `Invitation sent to ${address}.`, !isResend);
  }

  return (
    <Card className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Invite accountant</h2>
        <p className="mt-1 max-w-prose text-sm text-slate-600">
          Give an accountant read-only access to this workspace’s reports, expenses, and receipts.
        </p>
      </div>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          send(email.trim());
        }}
      >
        <label className="block w-full max-w-md text-sm font-medium text-slate-700">
          Accountant email
          <Input
            autoComplete="off"
            className="mt-1"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="accountant@example.com"
            required
            type="email"
            value={email}
          />
        </label>
        <Button className="shrink-0" disabled={isPending} type="submit">Send invitation</Button>
      </form>
      {feedback && (
        <div role={feedback.error ? "alert" : "status"}>
          <Alert variant={feedback.error ? "danger" : "success"}>{feedback.message}</Alert>
        </div>
      )}
      {invites.length > 0 && (
        <ul aria-label="Accountant invitations" className="divide-y divide-slate-100 border-t border-slate-100">
          {invites.map((invite) => {
            const canRevoke = ["Sending", "Sent", "Link created", "Delivery failed"].includes(invite.status);
            return (
              <li className="flex flex-wrap items-center justify-between gap-3 py-3" key={invite.id}>
                <div className="min-w-0">
                  <p className="break-all text-sm font-medium text-slate-900">{invite.email}</p>
                  {canRevoke && <p className="text-xs text-slate-500">Expires {invite.expiresOn} UTC</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={invite.status === "Accepted" || invite.status === "Sent" ? "brand" : "neutral"}>
                    {invite.status}
                  </Badge>
                  {invite.status !== "Accepted" && (
                    <Button disabled={isPending} onClick={() => send(invite.email, true)} type="button" variant="secondary">
                      Resend
                    </Button>
                  )}
                  {canRevoke && (
                    <Button
                      disabled={isPending}
                      onClick={() => {
                        if (window.confirm(`Revoke the invitation for ${invite.email}?`)) {
                          submit(csrfFetch(`${endpoint}/${invite.id}`, { method: "DELETE" }), "Invitation revoked.");
                        }
                      }}
                      type="button"
                      variant="secondary"
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
