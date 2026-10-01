import assert from "node:assert/strict";
import test from "node:test";
import type { HouseholdKind, HouseholdRole } from "@prisma/client";
import type { AuthContext } from "../lib/auth/session";
import {
  canCreateExpense,
  canInviteRole,
  canRevokeInviteRole,
  canManageExpense,
  canViewReports,
  expenseReadScope,
  isRoleAllowedForKind,
  isScopedToOwnExpenses,
} from "../lib/auth/permissions";
import { roleLabel } from "../lib/auth/role-labels";

function auth(role: HouseholdRole, kind: HouseholdKind, userId = "user-a"): AuthContext {
  return {
    user: { id: userId, name: "U", email: "u@example.com", role: "USER" },
    householdId: "household-a",
    householdName: "Org",
    householdKind: kind,
    householdRole: role,
    households: [{ id: "household-a", name: "Org", kind, role }],
  };
}

test("accountant can read everything but cannot create, edit, or delete", () => {
  const accountant = auth("ACCOUNTANT", "COMPANY");
  assert.equal(canCreateExpense(accountant), false);
  assert.equal(canManageExpense(accountant, "someone-else"), false);
  assert.equal(canManageExpense(accountant, accountant.user.id), false);
  assert.equal(canViewReports(accountant), true);
  assert.deepEqual(expenseReadScope(accountant), {});
});

test("company employee is limited to their own expenses and cannot see reports", () => {
  const employee = auth("MEMBER", "COMPANY", "emp-1");
  assert.equal(isScopedToOwnExpenses(employee), true);
  assert.equal(canViewReports(employee), false);
  assert.deepEqual(expenseReadScope(employee), {
    OR: [{ userId: "emp-1" }, { paidByUserId: "emp-1" }],
  });
  assert.equal(canCreateExpense(employee), true);
});

test("family members keep seeing every expense and report", () => {
  const member = auth("MEMBER", "FAMILY");
  assert.equal(isScopedToOwnExpenses(member), false);
  assert.equal(canViewReports(member), true);
  assert.deepEqual(expenseReadScope(member), {});
});

test("company admin and owner are not limited", () => {
  for (const role of ["OWNER", "ADMIN"] as const) {
    const a = auth(role, "COMPANY");
    assert.deepEqual(expenseReadScope(a), {});
    assert.equal(canViewReports(a), true);
  }
});

test("owner and admin can invite an accountant; an employee cannot", () => {
  assert.equal(canInviteRole("OWNER", "ACCOUNTANT", "COMPANY"), true);
  assert.equal(canInviteRole("ADMIN", "ACCOUNTANT", "COMPANY"), true);
  assert.equal(canInviteRole("MEMBER", "ACCOUNTANT", "COMPANY"), false);
  assert.equal(canInviteRole("ACCOUNTANT", "MEMBER", "COMPANY"), false);
  assert.equal(canInviteRole("ADMIN", "OWNER", "COMPANY"), false);
});

test("member is labelled Employee only in a company", () => {
  assert.equal(roleLabel("MEMBER", "COMPANY"), "Employee");
  assert.equal(roleLabel("MEMBER", "FAMILY"), "Member");
  assert.equal(roleLabel("ACCOUNTANT", "COMPANY"), "Accountant");
});

test("a company viewer is read-scoped like an employee, not given company-wide read", () => {
  const viewer = auth("VIEWER", "COMPANY", "view-1");
  assert.equal(isScopedToOwnExpenses(viewer), true);
  assert.equal(canViewReports(viewer), false);
  assert.deepEqual(expenseReadScope(viewer), {
    OR: [{ userId: "view-1" }, { paidByUserId: "view-1" }],
  });
  assert.equal(canCreateExpense(viewer), false);
});

test("a family viewer still reads the whole household", () => {
  const viewer = auth("VIEWER", "FAMILY");
  assert.equal(isScopedToOwnExpenses(viewer), false);
  assert.equal(canViewReports(viewer), true);
  assert.deepEqual(expenseReadScope(viewer), {});
});

test("VIEWER is a family-only role", () => {
  assert.equal(isRoleAllowedForKind("VIEWER", "FAMILY"), true);
  assert.equal(isRoleAllowedForKind("VIEWER", "COMPANY"), false);
  for (const role of ["OWNER", "ADMIN", "MEMBER", "ACCOUNTANT"] as const) {
    assert.equal(isRoleAllowedForKind(role, "COMPANY"), true);
    assert.equal(isRoleAllowedForKind(role, "FAMILY"), true);
  }
});

test("nobody can invite a viewer into a company", () => {
  assert.equal(canInviteRole("OWNER", "VIEWER", "COMPANY"), false);
  assert.equal(canInviteRole("ADMIN", "VIEWER", "COMPANY"), false);
  assert.equal(canInviteRole("OWNER", "VIEWER", "FAMILY"), true);
  assert.equal(canInviteRole("ADMIN", "VIEWER", "FAMILY"), true);
});

test("an admin can still revoke a VIEWER invite left over in a company", () => {
  // The role can no longer be invited there, but cleanup must not be blocked.
  assert.equal(canInviteRole("ADMIN", "VIEWER", "COMPANY"), false);
  assert.equal(canRevokeInviteRole("ADMIN", "VIEWER"), true);
  assert.equal(canRevokeInviteRole("OWNER", "VIEWER"), true);
  assert.equal(canRevokeInviteRole("MEMBER", "VIEWER"), false);
  assert.equal(canRevokeInviteRole("ADMIN", "OWNER"), false);
});
