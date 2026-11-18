import { AccountantShell } from "@/components/accountant-shell";
import { ButtonLink, Card } from "@/components/ui";
import { getUserHousehold, requireUser } from "@/lib/auth/session";
import { workspaceReportsHref } from "@/lib/report-links";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const user = await requireUser();
  const auth = await getUserHousehold(user);
  const clients = (auth?.households ?? [])
    .filter((household) => household.role === "ACCOUNTANT")
    .sort((left, right) => left.name.localeCompare(right.name));

  return (
    <AccountantShell>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Clients</h1>
          <p className="mt-1 text-sm text-slate-600">Choose a client to view reports and download receipts.</p>
        </div>
        {clients.length ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {clients.map((client) => (
              <li key={client.id}>
                <Card className="flex h-full flex-col items-start justify-between gap-4">
                  <h2 className="break-words text-lg font-semibold text-slate-900">{client.name}</h2>
                  <ButtonLink href={workspaceReportsHref(client.id)}>Open reports</ButtonLink>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <Card>
            <p className="text-sm text-slate-600">
              Once you accept an accountant invitation, the client’s reports will appear here.
            </p>
          </Card>
        )}
      </div>
    </AccountantShell>
  );
}
