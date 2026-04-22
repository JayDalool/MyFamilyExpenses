import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getCurrentUser } from "@/lib/auth/session";

export default async function LoginPage() {
  const user = await getCurrentUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 via-white to-slate-100 px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-brand-600">
            Self-hosted family tracker
          </p>
          <h1 className="text-4xl font-semibold text-slate-900">MyFamilyExpenses</h1>
          <p className="text-sm text-slate-600">
            Sign in to upload invoices, track categories, and view family expense totals.
          </p>
        </div>

        <LoginForm />
      </div>
    </div>
  );
}
