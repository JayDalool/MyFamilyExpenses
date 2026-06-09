import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/logout-button";
import { Card } from "@/components/ui";
import { getCurrentHousehold, getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function NoHouseholdPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login");

  const auth = await getCurrentHousehold();
  if (auth) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12">
      <Card className="w-full max-w-lg">
        <div className="space-y-5">
          <div>
            <p className="text-sm font-semibold text-brand-700">Signed in as {user.email}</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">No household access</h1>
            <p className="mt-2 text-sm text-slate-600">
              Your account is not currently a member of any active household.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            Open a valid household invite link to join a household, or sign out and contact
            the household owner.
          </div>

          <LogoutButton />
        </div>
      </Card>
    </main>
  );
}
