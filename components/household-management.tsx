"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { Alert, Badge, Button, Card, Input, Select, Table } from "@/components/ui";

type Member = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  joinedAt: string;
};

type Invite = {
  id: string;
  email: string | null;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  canRevoke: boolean;
};

export function HouseholdManagement({
  currentRole,
  members,
  invites,
  canInvite,
  canManageMembers,
}: {
  currentRole: Member["role"];
  members: Member[];
  invites: Invite[];
  canInvite: boolean;
  canManageMembers: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const allowedInviteRoles =
    currentRole === "OWNER" ? ["ADMIN", "MEMBER", "VIEWER"] : ["MEMBER", "VIEWER"];

  const mutate = (
    input: RequestInfo,
    init: RequestInit,
    success?: (data: unknown) => void,
  ) => {
    startTransition(() => {
      void (async () => {
        setError(null);
        const response = await csrfFetch(input, init);
        const data = (await response.json().catch(() => null)) as
          | { data?: unknown; error?: { message?: string } }
          | null;

        if (!response.ok) {
          setError(data?.error?.message ?? "Unable to update the household.");
          return;
        }

        success?.(data?.data);
        router.refresh();
      })();
    });
  };

  const createInvite = (formData: FormData) => {
    mutate(
      "/api/household/invites",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(formData.get("email") ?? ""),
          role: String(formData.get("role") ?? ""),
          expiresInDays: Number(formData.get("expiresInDays") ?? 7),
          maxUses: Number(formData.get("maxUses") ?? 1),
        }),
      },
      (data) => {
        const result = data as { inviteUrl?: string } | undefined;
        setInviteUrl(result?.inviteUrl ?? null);
      },
    );
  };

  const changeRole = (
    member: Member,
    nextRole: Member["role"],
    select: HTMLSelectElement,
  ) => {
    if (nextRole === member.role) return;
    const sensitive = member.role === "OWNER" || nextRole === "OWNER" || nextRole === "ADMIN";
    const message = sensitive
      ? `Change ${member.name}'s role from ${member.role} to ${nextRole}? This changes sensitive household access.`
      : `Change ${member.name}'s role from ${member.role} to ${nextRole}?`;
    if (!window.confirm(message)) {
      select.value = member.role;
      return;
    }

    mutate(`/api/household/members/${member.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: nextRole }),
    });
  };

  return (
    <div className="space-y-6">
      {error ? <Alert variant="danger">{error}</Alert> : null}

      <Card>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Members</h2>
          <p className="text-sm text-slate-500">Active access to this household.</p>
        </div>
        <div className="divide-y divide-slate-100 sm:hidden">
          {members.map((member) => (
            <div className="space-y-3 py-4 first:pt-0 last:pb-0" key={member.id}>
              <div>
                <p className="font-medium text-slate-900">{member.name}</p>
                <p className="break-all text-xs text-slate-500">{member.email}</p>
                <p className="mt-1 text-xs text-slate-500">Joined {member.joinedAt.slice(0, 10)}</p>
              </div>
              <div className="flex items-center gap-2">
                {canManageMembers ? (
                  <>
                    <Select
                      aria-label={`Role for ${member.name}`}
                      defaultValue={member.role}
                      disabled={isPending}
                      onChange={(event) =>
                        changeRole(member, event.target.value as Member["role"], event.currentTarget)
                      }
                    >
                      {["OWNER", "ADMIN", "MEMBER", "VIEWER"].map((role) => (
                        <option key={role} value={role}>{role}</option>
                      ))}
                    </Select>
                    <Button
                      disabled={isPending}
                      onClick={() => {
                        if (window.confirm(`Remove ${member.name} from this household?`)) {
                          mutate(`/api/household/members/${member.id}`, { method: "DELETE" });
                        }
                      }}
                      type="button"
                      variant="danger"
                    >
                      Remove
                    </Button>
                  </>
                ) : (
                  <Badge variant={member.role === "OWNER" ? "brand" : "neutral"}>{member.role}</Badge>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="hidden sm:block">
          <Table>
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <th className="px-3 py-3 font-semibold">Member</th>
                <th className="px-3 py-3 font-semibold">Role</th>
                <th className="px-3 py-3 font-semibold">Joined</th>
                {canManageMembers ? <th className="px-3 py-3 text-right font-semibold">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr className="border-b border-slate-100 last:border-0" key={member.id}>
                  <td className="px-3 py-4">
                    <p className="font-medium text-slate-900">{member.name}</p>
                    <p className="text-xs text-slate-500">{member.email}</p>
                  </td>
                  <td className="px-3 py-4">
                    {canManageMembers ? (
                      <Select
                        aria-label={`Role for ${member.name}`}
                        defaultValue={member.role}
                        disabled={isPending}
                        onChange={(event) =>
                          changeRole(member, event.target.value as Member["role"], event.currentTarget)
                        }
                      >
                        {["OWNER", "ADMIN", "MEMBER", "VIEWER"].map((role) => (
                          <option key={role} value={role}>{role}</option>
                        ))}
                      </Select>
                    ) : (
                      <Badge variant={member.role === "OWNER" ? "brand" : "neutral"}>{member.role}</Badge>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-slate-600">
                    {member.joinedAt.slice(0, 10)}
                  </td>
                  {canManageMembers ? (
                    <td className="px-3 py-4 text-right">
                      <Button
                        disabled={isPending}
                        onClick={() => {
                          if (window.confirm(`Remove ${member.name} from this household?`)) {
                            mutate(`/api/household/members/${member.id}`, { method: "DELETE" });
                          }
                        }}
                        type="button"
                        variant="danger"
                      >
                        Remove
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      {canInvite ? (
        <Card>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Invite member</h2>
            <p className="text-sm text-slate-500">
              The secure link is shown once. Only its hash is stored.
            </p>
          </div>

          <form
            action={(formData) => createInvite(formData)}
            className="grid gap-4 md:grid-cols-2"
          >
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Email restriction (optional)
              <Input name="email" placeholder="person@example.com" type="email" />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Role
              <Select name="role" defaultValue="MEMBER">
                {allowedInviteRoles.map((role) => <option key={role} value={role}>{role}</option>)}
              </Select>
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Expires in days
              <Input defaultValue="7" max="30" min="1" name="expiresInDays" type="number" />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Maximum uses
              <Input defaultValue="1" max="100" min="1" name="maxUses" type="number" />
            </label>
            <div className="md:col-span-2">
              <Button disabled={isPending} type="submit">Create invite link</Button>
            </div>
          </form>

          {inviteUrl ? (
            <Alert variant="success">
              <p className="font-medium">Invite link created</p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <Input aria-label="New invite link" readOnly value={inviteUrl} />
                <Button
                  onClick={() => void navigator.clipboard.writeText(inviteUrl)}
                  type="button"
                  variant="secondary"
                >
                  Copy
                </Button>
              </div>
            </Alert>
          ) : null}
        </Card>
      ) : null}

      {canInvite ? (
        <Card>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Pending invites</h2>
            <p className="text-sm text-slate-500">Links can be revoked, but cannot be recovered from the database.</p>
          </div>
          {invites.length === 0 ? (
            <p className="text-sm text-slate-500">No pending invites.</p>
          ) : (
            <>
              <div className="divide-y divide-slate-100 sm:hidden">
                {invites.map((invite) => (
                  <div className="space-y-3 py-4 first:pt-0 last:pb-0" key={invite.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="break-all text-sm font-medium text-slate-900">
                          {invite.email ?? "Anyone with link"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Expires {invite.expiresAt.slice(0, 10)} | Used {invite.usedCount} / {invite.maxUses}
                        </p>
                      </div>
                      <Badge>{invite.role}</Badge>
                    </div>
                    {invite.canRevoke ? (
                      <Button
                        disabled={isPending}
                        onClick={() => {
                          if (window.confirm("Revoke this invite link?")) {
                            mutate(`/api/household/invites/${invite.id}`, { method: "DELETE" });
                          }
                        }}
                        type="button"
                        variant="danger"
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="hidden sm:block">
                <Table>
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                      <th className="px-3 py-3 font-semibold">Restriction</th>
                      <th className="px-3 py-3 font-semibold">Role</th>
                      <th className="px-3 py-3 font-semibold">Usage</th>
                      <th className="px-3 py-3 font-semibold">Expires</th>
                      <th className="px-3 py-3 text-right font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invites.map((invite) => (
                      <tr className="border-b border-slate-100 last:border-0" key={invite.id}>
                        <td className="px-3 py-4 text-slate-700">{invite.email ?? "Anyone with link"}</td>
                        <td className="px-3 py-4"><Badge>{invite.role}</Badge></td>
                        <td className="px-3 py-4 text-slate-600">{invite.usedCount} / {invite.maxUses}</td>
                        <td className="px-3 py-4 text-slate-600">{invite.expiresAt.slice(0, 10)}</td>
                        <td className="px-3 py-4 text-right">
                          {invite.canRevoke ? (
                            <Button
                              disabled={isPending}
                              onClick={() => {
                                if (window.confirm("Revoke this invite link?")) {
                                  mutate(`/api/household/invites/${invite.id}`, { method: "DELETE" });
                                }
                              }}
                              type="button"
                              variant="danger"
                            >
                              Revoke
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </>
          )}
        </Card>
      ) : null}
    </div>
  );
}
