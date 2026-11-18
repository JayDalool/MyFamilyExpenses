import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { prisma } from "../lib/db/prisma";
import { getUserHousehold, type AuthContext } from "../lib/auth/session";
import {
  acceptHouseholdInviteForUser,
  consumeInviteUse,
  createHouseholdInvite,
  deliverAccountantInvite,
  hashInviteToken,
  InviteAcceptanceError,
  revokeHouseholdInvite,
} from "../lib/household-invites";
import { createHouseholdInviteSchema } from "../lib/validation/household";
import { assertSafeTestDatabase } from "./helpers/test-database";

assertSafeTestDatabase();
let fixture: Awaited<ReturnType<typeof setup>>;

async function setup() {
  const user = (name: string) => prisma.user.create({
    data: { name, email: `${crypto.randomUUID()}@example.com` },
  });
  const [owner, accountant, other] = await Promise.all([
    user("Client Owner"),
    user("Accountant"),
    user("Other User"),
  ]);
  const first = await prisma.household.create({ data: { name: "First client", kind: "COMPANY" } });
  const second = await prisma.household.create({ data: { name: "Second client" } });
  await prisma.membership.createMany({
    data: [first, second].map((household) => ({ userId: owner.id, householdId: household.id, role: "OWNER" })),
  });
  const auth = (household: typeof first): AuthContext => ({
    user: { id: owner.id, name: owner.name, email: owner.email, role: owner.role },
    householdId: household.id,
    householdName: household.name,
    householdKind: household.kind,
    householdRole: "OWNER",
    households: [{ id: household.id, name: household.name, kind: household.kind, role: "OWNER" }],
  });
  return { owner, accountant, other, first: auth(first), second: auth(second) };
}

before(async () => { fixture = await setup(); });

after(async () => {
  if (!fixture) return;
  const householdIds = [fixture.first.householdId, fixture.second.householdId];
  await prisma.auditLog.deleteMany({ where: { householdId: { in: householdIds } } });
  await prisma.household.deleteMany({ where: { id: { in: householdIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [fixture.owner.id, fixture.accountant.id, fixture.other.id] } } });
  await prisma.$disconnect();
});

const inviteFields = { role: "ACCOUNTANT", expiresInDays: 7, maxUses: 1 } as const;
const deliver = async () => {};

test("accountant invitations require a workspace, one use and an email address", () => {
  assert.equal(createHouseholdInviteSchema.safeParse(inviteFields).success, false);
  assert.equal(createHouseholdInviteSchema.safeParse({
    ...inviteFields, householdId: fixture.first.householdId, email: "Person@example.com", maxUses: 2,
  }).success, false);
  assert.equal(createHouseholdInviteSchema.parse({
    ...inviteFields, householdId: fixture.first.householdId, email: " Person@EXAMPLE.com ",
  }).email, "person@example.com");
});

test("delivery failure is recorded and resending replaces the earlier link", async () => {
  const input = { ...inviteFields, email: fixture.accountant.email };
  const first = await createHouseholdInvite(fixture.first, input);
  assert.equal(first.invite.emailStatus, "PENDING");
  assert.equal(first.invite.tokenHash, hashInviteToken(first.token));
  await assert.rejects(
    createHouseholdInvite(fixture.first, input),
    (error: unknown) => error instanceof InviteAcceptanceError && error.reason === "email_in_progress",
  );
  assert.equal(await deliverAccountantInvite(fixture.first, first.invite, "https://example.com/invite/test", async () => {
    throw new Error("Synthetic SMTP rejection");
  }), "FAILED");
  assert.equal((await acceptHouseholdInviteForUser(first.token, fixture.accountant)).ok, false);

  const replacement = await createHouseholdInvite(fixture.first, input);
  assert.ok((await prisma.householdInvite.findUniqueOrThrow({ where: { id: first.invite.id } })).revokedAt);
  assert.notEqual(replacement.token, first.token);
  assert.equal(await deliverAccountantInvite(fixture.first, replacement.invite, "https://example.com/invite/test", deliver), "SENT");
  assert.equal(await revokeHouseholdInvite(fixture.first, replacement.invite.id).then((invite) => Boolean(invite?.revokedAt)), true);
  assert.equal((await acceptHouseholdInviteForUser(replacement.token, fixture.accountant)).ok, false);
});

test("a verified accountant confirms each client and loses access after membership removal", async () => {
  for (const auth of [fixture.first, fixture.second]) {
    const { invite, token } = await createHouseholdInvite(auth, { ...inviteFields, email: fixture.accountant.email });
    await deliverAccountantInvite(auth, invite, "https://example.com/invite/test", deliver);
    assert.equal((await acceptHouseholdInviteForUser(token, fixture.other)).ok, false);
    await assert.rejects(
      consumeInviteUse(invite),
      (error: unknown) => error instanceof InviteAcceptanceError && error.reason === "email_unverified",
    );

    if (auth === fixture.first) {
      const unverified = await acceptHouseholdInviteForUser(token, fixture.accountant);
      assert.equal(unverified.ok, false);
      if (!unverified.ok) assert.equal(unverified.reason, "email_unverified");
      await prisma.user.update({ where: { id: fixture.accountant.id }, data: { emailVerifiedAt: new Date() } });
    }

    const signIn = await acceptHouseholdInviteForUser(token, fixture.accountant, undefined, { deferAccountant: true });
    assert.equal(signIn.ok, false);
    if (!signIn.ok) assert.equal(signIn.reason, "confirmation_required");
    assert.equal(await getUserHousehold(fixture.accountant, auth.householdId), null);

    const accepted = await acceptHouseholdInviteForUser(token, fixture.accountant);
    assert.equal(accepted.ok && accepted.role, "ACCOUNTANT");
    assert.equal((await acceptHouseholdInviteForUser(token, fixture.accountant)).ok, false);
  }

  assert.equal((await getUserHousehold(fixture.accountant, fixture.first.householdId))?.householdRole, "ACCOUNTANT");
  assert.equal((await getUserHousehold(fixture.accountant, fixture.second.householdId))?.households.length, 2);
  await prisma.membership.update({
    where: { userId_householdId: { userId: fixture.accountant.id, householdId: fixture.first.householdId } },
    data: { removedAt: new Date() },
  });
  assert.equal(await getUserHousehold(fixture.accountant, fixture.first.householdId), null);
  assert.equal((await getUserHousehold(fixture.accountant, fixture.second.householdId))?.householdRole, "ACCOUNTANT");
});
