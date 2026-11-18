import { ButtonLink, Card } from "@/components/ui";

export default function InvitationUnavailable() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12">
      <Card className="w-full max-w-md space-y-4">
        <h1 className="text-2xl font-bold text-slate-900">Invitation unavailable</h1>
        <p className="text-sm text-slate-600">
          Ask the person who invited you for a new link. If you already accepted, sign in to open your reports.
        </p>
        <ButtonLink href="/auth/login">Sign in</ButtonLink>
      </Card>
    </main>
  );
}
