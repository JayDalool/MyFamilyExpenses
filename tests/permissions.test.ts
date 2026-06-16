import assert from "node:assert/strict";
import test from "node:test";
import type { HouseholdRole } from "@prisma/client";
import type { AuthContext } from "../lib/auth/session";
import {
  canCreateExpense,
  canInviteMembers,
  canInviteRole,
  canManageCategories,
  canManageExpense,
  canManageMembers,
  canViewOcrLearning,
} from "../lib/auth/permissions";

function auth(role: HouseholdRole, userId = "user-a"): AuthContext {
  return {
    user: { id: userId, name: "Role User", email: "role@example.com", role: "USER" },
    householdId: "household-a",
    householdName: "Role Household",
    householdRole: role,
    households: [{ id: "household-a", name: "Role Household", role }],
  };
}

test("household role permission matrix is enforced", () => {
  const owner = auth("OWNER");
  const admin = auth("ADMIN");
  const member = auth("MEMBER");
  const viewer = auth("VIEWER");

  assert.equal(canCreateExpense(owner), true);
  assert.equal(canCreateExpense(admin), true);
  assert.equal(canCreateExpense(member), true);
  assert.equal(canCreateExpense(viewer), false);

  assert.equal(canManageExpense(owner, "another-user"), true);
  assert.equal(canManageExpense(admin, "another-user"), true);
  assert.equal(canManageExpense(member, member.user.id), true);
  assert.equal(canManageExpense(member, "another-user"), false);
  assert.equal(canManageExpense(viewer, viewer.user.id), false);

  assert.equal(canManageCategories(owner), true);
  assert.equal(canManageCategories(admin), true);
  assert.equal(canManageCategories(member), false);
  assert.equal(canManageCategories(viewer), false);

  assert.equal(canInviteMembers(owner), true);
  assert.equal(canInviteMembers(admin), true);
  assert.equal(canInviteMembers(member), false);
  assert.equal(canInviteMembers(viewer), false);

  assert.equal(canManageMembers(owner), true);
  assert.equal(canManageMembers(admin), false);
  assert.equal(canManageMembers(member), false);
  assert.equal(canManageMembers(viewer), false);

  // Internal OCR diagnostics: OWNER/ADMIN only.
  assert.equal(canViewOcrLearning(owner), true);
  assert.equal(canViewOcrLearning(admin), true);
  assert.equal(canViewOcrLearning(member), false);
  assert.equal(canViewOcrLearning(viewer), false);

  assert.equal(canInviteRole("OWNER", "ADMIN"), true);
  assert.equal(canInviteRole("OWNER", "OWNER"), false);
  assert.equal(canInviteRole("ADMIN", "MEMBER"), true);
  assert.equal(canInviteRole("ADMIN", "VIEWER"), true);
  assert.equal(canInviteRole("ADMIN", "ADMIN"), false);
  assert.equal(canInviteRole("MEMBER", "VIEWER"), false);
  assert.equal(canInviteRole("VIEWER", "VIEWER"), false);
});
