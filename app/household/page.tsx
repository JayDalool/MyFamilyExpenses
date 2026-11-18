import { AppShell } from "@/components/app-shell";
import { redirect } from "next/navigation";
import { CreateCompanyForm } from "@/components/create-company-form";
import { HouseholdManagement } from "@/components/household-management";
import { AccountantInvitations } from "@/components/accountant-invitations";
import { Badge } from "@/components/ui";
import { requireHouseholdMember } from "@/lib/auth/session";
import { roleLabel } from "@/lib/auth/role-labels";
import { canInviteMembers, canManageMembers, canRevokeInviteRole } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db/prisma";
import { workspaceReportsHref } from "@/lib/report-links";

export const dynamic = "force-dynamic";

export default async function HouseholdPage() {
  const auth = await requireHouseholdMember();
  if (auth.householdRole === "ACCOUNTANT") redirect(workspaceReportsHref(auth.householdId));
  const inviteAccess = canInviteMembers(auth);
  const [members, invites, accountantInvites] = await Promise.all([
    prisma.membership.findMany({
      where: { householdId: auth.householdId, removedAt: null },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    }),
    inviteAccess
      ? prisma.householdInvite.findMany({
          where: {
            householdId: auth.householdId,
            role: { not: "ACCOUNTANT" },
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
    inviteAccess
      ? prisma.householdInvite.findMany({
          where: { householdId: auth.householdId, role: "ACCOUNTANT", email: { not: null } },
          distinct: ["email"],
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            email: true,
            emailStatus: true,
            expiresAt: true,
            revokedAt: true,
            usedCount: true,
          },
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
            Your role{" "}
            <Badge variant="brand">{roleLabel(auth.householdRole, auth.householdKind)}</Badge>
          </div>
        </header>

        {inviteAccess && (
          <AccountantInvitations
            householdId={auth.householdId}
            invites={accountantInvites.map((invite) => {
              const status = invite.usedCount > 0 ? "Accepted"
                : invite.revokedAt ? "Revoked"
                  : invite.expiresAt <= new Date() ? "Expired"
                    : invite.emailStatus === "PENDING" ? "Sending"
                      : invite.emailStatus === "FAILED" ? "Delivery failed"
                        : invite.emailStatus === "SENT" ? "Sent" : "Link created";
              return {
                id: invite.id,
                email: invite.email ?? "",
                status,
                expiresOn: invite.expiresAt.toISOString().slice(0, 10),
              };
            })}
          />
        )}

        <HouseholdManagement
          householdKind={auth.householdKind}
          canInvite={inviteAccess}
          canManageMembers={canManageMembers(auth)}
          currentRole={auth.householdRole}
          invites={invites
            .filter((invite) => invite.usedCount < invite.maxUses)
            .map((invite) => ({
              ...invite,
              canRevoke:
                auth.householdRole === "OWNER" ||
                canRevokeInviteRole(auth.householdRole, invite.role),
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

        <CreateCompanyForm />
      </div>
    </AppShell>
  );
}
