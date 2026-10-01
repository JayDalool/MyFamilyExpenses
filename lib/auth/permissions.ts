import type { HouseholdRole, Prisma } from "@prisma/client";
import type { AuthContext } from "@/lib/auth/session";

// VIEWER and ACCOUNTANT are read-only roles.
export function isReadOnlyRole(role: HouseholdRole) {
  return role === "VIEWER" || role === "ACCOUNTANT";
}

export function canCreateExpense(auth: AuthContext) {
  return !isReadOnlyRole(auth.householdRole);
}

// In a COMPANY household an employee (MEMBER) sees only their own expenses.
// In a FAMILY household every member sees every expense.
export function isCompanyEmployee(auth: Pick<AuthContext, "householdKind" | "householdRole">) {
  return auth.householdKind === "COMPANY" && auth.householdRole === "MEMBER";
}

// Prisma filter limiting which expenses this member may read (entered or paid by them).
export function expenseReadScope(auth: AuthContext): Prisma.ExpenseWhereInput {
  if (!isCompanyEmployee(auth)) return {};
  return { OR: [{ userId: auth.user.id }, { paidByUserId: auth.user.id }] };
}

// Household-wide totals, reports, and exports. Hidden from company employees,
// who would otherwise see colleagues' spending.
export function canViewReports(auth: AuthContext) {
  return !isCompanyEmployee(auth);
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

export function canInviteRole(inviterRole: HouseholdRole, invitedRole: HouseholdRole) {
  if (invitedRole === "OWNER") return false;
  if (inviterRole === "OWNER") return true;
  return (
    inviterRole === "ADMIN" &&
    (invitedRole === "MEMBER" || invitedRole === "VIEWER" || invitedRole === "ACCOUNTANT")
  );
}

export function canManageMembers(auth: AuthContext) {
  return auth.householdRole === "OWNER";
}

export function canInviteMembers(auth: AuthContext) {
  return auth.householdRole === "OWNER" || auth.householdRole === "ADMIN";
}
