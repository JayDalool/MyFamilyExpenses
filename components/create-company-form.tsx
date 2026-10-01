"use client";

import { useState, useTransition } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { Alert, Button, Card, Input } from "@/components/ui";

export function CreateCompanyForm() {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (formData: FormData) => {
    startTransition(() => {
      void (async () => {
        setError(null);
        const response = await csrfFetch("/api/households/company", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: String(formData.get("name") ?? "") }),
        });
        const data = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;

        if (!response.ok) {
          setError(data?.error?.message ?? "Unable to create the company.");
          return;
        }

        window.location.assign("/household");
      })();
    });
  };

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold text-slate-900">Start a company workspace</h2>
      <p className="mt-1 text-sm text-slate-500">
        A separate workspace for a business. Employees see only their own receipts. Admins and
        accountants see everything. Your family household is not changed.
      </p>
      {error ? <Alert variant="danger">{error}</Alert> : null}
      <form action={submit} className="mt-4 flex flex-col gap-3 sm:flex-row">
        <Input aria-label="Company name" maxLength={80} name="name" placeholder="Company name" required />
        <Button disabled={isPending} type="submit">
          Create company
        </Button>
      </form>
    </Card>
  );
}
