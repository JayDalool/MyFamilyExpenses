import { notFound } from "next/navigation";
import { Button, Card } from "@/components/ui";
import { CSRF_FORM_FIELD_NAME } from "@/lib/auth/csrf";
import { getRequestCsrfToken } from "@/lib/auth/csrf-server";

export const metadata = { referrer: "no-referrer" as const };

export default async function VerifyAccountantPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) notFound();
  const csrfToken = await getRequestCsrfToken();

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12">
      <Card className="w-full max-w-md space-y-4">
        <h1 className="text-2xl font-bold text-slate-900">Verify your email</h1>
        <p className="text-sm text-slate-600">
          Confirm your email address and accept read-only access to your client’s reports and receipts.
        </p>
        <form action="/api/auth/signup/verify" method="post">
          <input name={CSRF_FORM_FIELD_NAME} type="hidden" value={csrfToken} />
          <input name="token" type="hidden" value={token} />
          <Button className="w-full" type="submit">Verify and accept invitation</Button>
        </form>
      </Card>
    </main>
  );
}
