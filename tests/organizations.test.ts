import assert from "node:assert/strict";
import test from "node:test";
import type { HouseholdKind, HouseholdRole } from "@prisma/client";
import type { AuthContext } from "../lib/auth/session";
import {
  canCreateExpense,
  canInviteRole,
  canManageExpense,
  canViewReports,
  expenseReadScope,
  isCompanyEmployee,
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
  assert.equal(isCompanyEmployee(employee), true);
  assert.equal(canViewReports(employee), false);
  assert.deepEqual(expenseReadScope(employee), {
    OR: [{ userId: "emp-1" }, { paidByUserId: "emp-1" }],
  });
  assert.equal(canCreateExpense(employee), true);
});

test("family members keep seeing every expense and report", () => {
  const member = auth("MEMBER", "FAMILY");
  assert.equal(isCompanyEmployee(member), false);
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
  assert.equal(canInviteRole("OWNER", "ACCOUNTANT"), true);
  assert.equal(canInviteRole("ADMIN", "ACCOUNTANT"), true);
  assert.equal(canInviteRole("MEMBER", "ACCOUNTANT"), false);
  assert.equal(canInviteRole("ACCOUNTANT", "MEMBER"), false);
  assert.equal(canInviteRole("ADMIN", "OWNER"), false);
});

test("member is labelled Employee only in a company", () => {
  assert.equal(roleLabel("MEMBER", "COMPANY"), "Employee");
  assert.equal(roleLabel("MEMBER", "FAMILY"), "Member");
  assert.equal(roleLabel("ACCOUNTANT", "COMPANY"), "Accountant");
});
