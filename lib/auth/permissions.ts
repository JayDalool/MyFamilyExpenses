import type { HouseholdRole } from "@prisma/client";
import type { AuthContext } from "@/lib/auth/session";

export function canCreateExpense(auth: AuthContext) {
  return auth.householdRole !== "VIEWER";
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

export function canInviteRole(inviterRole: HouseholdRole, invitedRole: HouseholdRole) {
  if (invitedRole === "OWNER") return false;
  if (inviterRole === "OWNER") return true;
  return inviterRole === "ADMIN" && (invitedRole === "MEMBER" || invitedRole === "VIEWER");
}

export function canManageMembers(auth: AuthContext) {
  return auth.householdRole === "OWNER";
}

export function canInviteMembers(auth: AuthContext) {
  return auth.householdRole === "OWNER" || auth.householdRole === "ADMIN";
}
