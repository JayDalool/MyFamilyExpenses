import { AppShell } from "@/components/app-shell";
import { HouseholdManagement } from "@/components/household-management";
import { Badge } from "@/components/ui";
import { requireHouseholdMember } from "@/lib/auth/session";
import { canInviteMembers, canInviteRole, canManageMembers } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export default async function HouseholdPage() {
  const auth = await requireHouseholdMember();
  const inviteAccess = canInviteMembers(auth);
  const [members, invites] = await Promise.all([
    prisma.membership.findMany({
      where: { householdId: auth.householdId, removedAt: null },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    }),
    inviteAccess
      ? prisma.householdInvite.findMany({
          where: {
            householdId: auth.householdId,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          select: {
            id: true,
            email: true,
            role: true,
            maxUses: true,
            usedCount: true,
            expiresAt: true,
          },
          orderBy: { createdAt: "desc" },
        })
      : [],
  ]);

  return (
    <AppShell auth={auth}>
      <div className="space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{auth.householdName}</h1>
            <p className="text-sm text-slate-500">Household members, roles, and secure invites.</p>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            Your role <Badge variant="brand">{auth.householdRole}</Badge>
          </div>
        </header>

        <HouseholdManagement
          canInvite={inviteAccess}
          canManageMembers={canManageMembers(auth)}
          currentRole={auth.householdRole}
          invites={invites
            .filter((invite) => invite.usedCount < invite.maxUses)
            .map((invite) => ({
              ...invite,
              canRevoke:
                auth.householdRole === "OWNER" ||
                canInviteRole(auth.householdRole, invite.role),
              expiresAt: invite.expiresAt.toISOString(),
            }))}
          members={members.map((membership) => ({
            id: membership.id,
            userId: membership.userId,
            name: membership.user.name,
            email: membership.user.email,
            role: membership.role,
            joinedAt: membership.createdAt.toISOString(),
          }))}
        />
      </div>
    </AppShell>
  );
}
