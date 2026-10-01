import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { InviteAcceptance } from "@/components/invite-acceptance";
import { Alert, Badge, ButtonLink, Card } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import {
  auditInviteFailure,
  getInviteSummaryByToken,
  hashInviteToken,
  inviteCapacityRateLimitOptions,
  probeInviteCapacityByHash,
} from "@/lib/household-invites";
import { inviteTokenSchema } from "@/lib/validation/household";
import {
  getInviteActorKeys,
  reserveInviteLookupAttempt,
} from "@/lib/invite-rate-limit";
import { extractClientIpFromHeaders } from "@/lib/rate-limit";
import { CSRF_REQUEST_HEADER_NAME } from "@/lib/auth/csrf";

type InvitePageProps = { params: Promise<{ token: string }> };

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  if (!inviteTokenSchema.safeParse(token).success) notFound();
  const tokenHash = hashInviteToken(token);

  const [user, requestHeaders, capacity] = await Promise.all([
    getCurrentUser(),
    headers(),
    probeInviteCapacityByHash(tokenHash),
  ]);
  const actorKeys = getInviteActorKeys({
    userId: user?.id,
    email: user?.email,
    ip: extractClientIpFromHeaders(requestHeaders),
    fingerprint: requestHeaders.get(CSRF_REQUEST_HEADER_NAME),
  });
  if (
    !(await reserveInviteLookupAttempt(
      tokenHash,
      actorKeys,
      inviteCapacityRateLimitOptions(capacity),
    ))
  ) {
    notFound();
  }

  const invite = await getInviteSummaryByToken(token);

  if (!invite) {
    await auditInviteFailure({
      actionUserId: user?.id ?? null,
      reason: "not_found",
      tokenHash,
      source: "invite_page",
    });
    notFound();
  }

  if (invite.unavailableReason) {
    await auditInviteFailure({
      actionUserId: user?.id ?? null,
      householdId: invite.householdId,
      reason: invite.unavailableReason,
      tokenHash,
      inviteId: invite.id,
      source: "invite_page",
    });
    notFound();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12">
      <Card className="w-full max-w-lg">
        <div className="space-y-5">
          <div>
            <p className="text-sm font-semibold text-brand-700">Household invitation</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">{invite.householdName}</h1>
            <p className="mt-2 text-sm text-slate-600">
              You have been invited to join with the <Badge variant="brand">{invite.role}</Badge> role.
            </p>
          </div>

          {invite.emailRestricted ? (
            <Alert>This invite can only be accepted by its designated email address.</Alert>
          ) : null}

          {user ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                Signed in as <span className="font-medium text-slate-900">{user.email}</span>
              </p>
              <InviteAcceptance token={token} />
            </div>
          ) : (
            <div className="space-y-3">
              <Alert variant="info">Sign in or create an account before accepting this invite.</Alert>
              <div className="grid gap-3 sm:grid-cols-2">
                <ButtonLink href={`/auth/login?invite=${encodeURIComponent(token)}`}>Sign in</ButtonLink>
                <ButtonLink href={`/auth/signup?invite=${encodeURIComponent(token)}`} variant="secondary">
                  Create account
                </ButtonLink>
              </div>
            </div>
          )}

          <p className="text-xs text-slate-500">
            Expires {invite.expiresAt.toISOString().slice(0, 10)}. Used {invite.usedCount} of {invite.maxUses} times.
          </p>
        </div>
      </Card>
    </main>
  );
}
