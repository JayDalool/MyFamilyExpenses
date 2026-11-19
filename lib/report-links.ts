export function workspaceReportsHref(householdId: string) {
  return `/reports/${encodeURIComponent(householdId)}`;
}
