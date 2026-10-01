import type { HouseholdKind, HouseholdRole, Prisma } from "@prisma/client";
import type { AuthContext } from "@/lib/auth/session";

// VIEWER and ACCOUNTANT are read-only roles.
export function isReadOnlyRole(role: HouseholdRole) {
  return role === "VIEWER" || role === "ACCOUNTANT";
}

export function canCreateExpense(auth: AuthContext) {
  return !isReadOnlyRole(auth.householdRole);
}

// A COMPANY has four roles: Owner, Admin, Accountant and Employee (MEMBER).
// VIEWER is a FAMILY-only role. It is not offered or accepted in a COMPANY
// because "Viewer" reads as *less* access than Employee while VIEWER is not
// scoped to its own expenses in a FAMILY.
export function isRoleAllowedForKind(role: HouseholdRole, kind: HouseholdKind) {
  return !(kind === "COMPANY" && role === "VIEWER");
}

// Roles that may read only the expenses they entered or paid for. MEMBER is the
// Employee role. VIEWER is included so that a row predating this rule, or one
// written straight to the database, still cannot read a colleague's receipts.
export function isScopedToOwnExpenses(
  auth: Pick<AuthContext, "householdKind" | "householdRole">,
) {
  if (auth.householdKind !== "COMPANY") return false;
  return auth.householdRole === "MEMBER" || auth.householdRole === "VIEWER";
}

// Prisma filter limiting which expenses this member may read (entered or paid by them).
export function expenseReadScope(auth: AuthContext): Prisma.ExpenseWhereInput {
  if (!isScopedToOwnExpenses(auth)) return {};
  return { OR: [{ userId: auth.user.id }, { paidByUserId: auth.user.id }] };
}

// Household-wide totals, reports, and exports. Hidden from the roles scoped to
// their own expenses, who would otherwise see colleagues' spending.
export function canViewReports(auth: AuthContext) {
  return !isScopedToOwnExpenses(auth);
}

// Who may attribute an expense (paid-by) to a member OTHER than themselves.
// Owners and admins can assign on behalf of any active member; members are
// limited to expenses they paid themselves.
export function canAssignExpenseToOthers(auth: AuthContext) {
  return auth.householdRole === "OWNER" || auth.householdRole === "ADMIN";
}

export function canManageExpense(auth: AuthContext, expenseOwnerUserId: string) {
  if (auth.householdRole === "OWNER" || auth.householdRole === "ADMIN") {
    return true;
  }

  return auth.householdRole === "MEMBER" && auth.user.id === expenseOwnerUserId;
}

export function canManageCategories(auth: AuthContext) {
  return auth.householdRole === "OWNER" || auth.householdRole === "ADMIN";
}

// Internal OCR diagnostics (/ocr-learning + its API) are NOT an end-user feature.
// They expose correction analytics and template-review tooling intended for the
// people who run the household, so they are restricted to OWNER/ADMIN. Regular
// members and viewers must not see them.
export function canViewOcrLearning(auth: AuthContext) {
  return auth.householdRole === "OWNER" || auth.householdRole === "ADMIN";
}

// Who outranks whom, ignoring the household kind. Owners hand out anything but
// OWNER; admins hand out the non-privileged roles.
function outranksForRole(granterRole: HouseholdRole, grantedRole: HouseholdRole) {
  if (grantedRole === "OWNER") return false;
  if (granterRole === "OWNER") return true;
  return (
    granterRole === "ADMIN" &&
    (grantedRole === "MEMBER" || grantedRole === "VIEWER" || grantedRole === "ACCOUNTANT")
  );
}

export function canInviteRole(
  inviterRole: HouseholdRole,
  invitedRole: HouseholdRole,
  kind: HouseholdKind,
) {
  if (!isRoleAllowedForKind(invitedRole, kind)) return false;
  return outranksForRole(inviterRole, invitedRole);
}

// Revoking is cleanup, not granting, so it ignores the household kind. An admin
// must still be able to revoke a VIEWER invite left over from before the
// household became a company, even though they can no longer create one.
export function canRevokeInviteRole(revokerRole: HouseholdRole, invitedRole: HouseholdRole) {
  return outranksForRole(revokerRole, invitedRole);
}

export function canManageMembers(auth: AuthContext) {
  return auth.householdRole === "OWNER";
}

export function canInviteMembers(auth: AuthContext) {
  return auth.householdRole === "OWNER" || auth.householdRole === "ADMIN";
}
