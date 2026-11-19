import { redirect } from "next/navigation";
import { requireHouseholdMember } from "@/lib/auth/session";
import { canViewReports } from "@/lib/auth/permissions";
import { workspaceReportsHref } from "@/lib/report-links";

export default async function ActiveWorkspaceReports({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireHouseholdMember();
  if (!canViewReports(auth)) redirect("/dashboard");

  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) query.append(name, item);
    }
  }
  const path = workspaceReportsHref(auth.householdId);
  redirect(query.size ? `${path}?${query}` : path);
}
