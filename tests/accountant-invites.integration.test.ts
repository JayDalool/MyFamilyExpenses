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
import { INVITE_EMAIL_RECIPIENT_DAILY_LIMIT } from "../lib/invite-rate-limit";
import { MIXED_REPORT_CURRENCIES_MESSAGE } from "../lib/reporting";
import { downloadReportForUser } from "../lib/reporting/report-download";
import { money } from "./helpers/expense-money";
import { createSignupVerificationToken, hashSignupVerificationToken } from "../lib/auth/signup-verification";
import { GET as verifySignupGet, POST as verifySignupPost } from "../app/api/auth/signup/verify/route";
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

test("an OAuth signup without a provider-verified email cannot use an accountant invitation", async () => {
  const email = `oauth-${crypto.randomUUID()}@example.com`;
  const { invite } = await createHouseholdInvite(fixture.second, { ...inviteFields, email });
  await deliverAccountantInvite(fixture.second, invite, "https://example.com/invite/test", deliver);
  // The OAuth callbacks pass the email only when the provider vouches for it.
  await assert.rejects(
    consumeInviteUse(invite, prisma, null),
    (error: unknown) => error instanceof InviteAcceptanceError && error.reason === "email_unverified",
  );
  await consumeInviteUse(invite, prisma, email);
  assert.equal((await prisma.householdInvite.findUniqueOrThrow({ where: { id: invite.id } })).usedCount, 1);
});

test("emailed invitations stop after the daily cap for one recipient", async () => {
  const email = `cap-${crypto.randomUUID()}@example.com`;
  const reasons: string[] = [];
  for (let attempt = 0; attempt <= INVITE_EMAIL_RECIPIENT_DAILY_LIMIT; attempt += 1) {
    // The first send stays PENDING, so later ones fail with email_in_progress;
    // each attempt still counts toward the cap, like a resend would.
    await createHouseholdInvite(fixture.second, { ...inviteFields, email }).then(
      () => reasons.push("created"),
      (error: unknown) => reasons.push(error instanceof InviteAcceptanceError ? error.reason : "other"),
    );
  }
  assert.equal(reasons[0], "created");
  assert.equal(reasons.at(-1), "rate_limited");
  assert.equal(reasons.filter((reason) => reason === "rate_limited").length, 1);
});

test("client report downloads are scoped to members and need one currency", async () => {
  const householdId = fixture.second.householdId;
  const category = await prisma.category.create({ data: { householdId, name: `Download ${crypto.randomUUID()}` } });
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const expenses = await Promise.all((["CAD", "USD"] as const).map((currency) => prisma.expense.create({
    data: {
      userId: fixture.owner.id,
      paidByUserId: fixture.owner.id,
      householdId,
      categoryId: category.id,
      invoiceNumber: `DL-${currency}-${crypto.randomUUID()}`,
      invoiceDate: today,
      currency,
      ...money(12.34),
      filePath: `uploads/download-${currency}.pdf`,
    },
  })));
  const url = (query: string) => new Request(`https://app.test/api/reports/${householdId}/export?${query}`);
  try {
    const outsider = await downloadReportForUser(url("format=csv&period=year"), fixture.other, householdId);
    assert.equal(outsider.status, 404);

    const mixed = await downloadReportForUser(url("format=csv&period=year"), fixture.owner, householdId);
    assert.equal(mixed.status, 400);
    assert.equal((await mixed.json()).error, MIXED_REPORT_CURRENCIES_MESSAGE);

    const usd = await downloadReportForUser(url("format=csv&period=year&currency=USD"), fixture.owner, householdId);
    assert.equal(usd.status, 200);
    const csv = await usd.text();
    assert.ok(csv.includes(expenses[1].invoiceNumber));
    assert.ok(!csv.includes(expenses[0].invoiceNumber));
  } finally {
    await prisma.expense.deleteMany({ where: { id: { in: expenses.map((expense) => expense.id) } } });
    await prisma.category.delete({ where: { id: category.id } });
  }
});

test("opening an accountant signup link only shows the confirmation step", async () => {
  const email = `verify-${crypto.randomUUID()}@example.com`;
  const { invite, token: inviteToken } = await createHouseholdInvite(fixture.first, { ...inviteFields, email });
  await deliverAccountantInvite(fixture.first, invite, "https://example.com/invite/test", deliver);
  const token = createSignupVerificationToken();
  const pending = await prisma.pendingSignup.create({
    data: {
      email,
      name: "Link Preview",
      passwordHash: "not-used",
      verificationTokenHash: hashSignupVerificationToken(token),
      inviteTokenHash: hashInviteToken(inviteToken),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  try {
    // Mail scanners fetch links with GET; that must not create the account.
    const opened = await verifySignupGet(new Request(`https://app.test/api/auth/signup/verify?token=${token}`));
    assert.equal(opened.status, 307);
    assert.equal(new URL(opened.headers.get("location")!).pathname, "/auth/verify-accountant");
    assert.ok(await prisma.pendingSignup.findUnique({ where: { id: pending.id } }));
    assert.equal(await prisma.user.findUnique({ where: { email } }), null);
    assert.equal((await prisma.householdInvite.findUniqueOrThrow({ where: { id: invite.id } })).usedCount, 0);

    // Once the pending signup is claimed, a second submit is refused.
    await prisma.pendingSignup.delete({ where: { id: pending.id } });
    const form = new FormData();
    form.set("token", token);
    const replay = await verifySignupPost(
      new Request("https://app.test/api/auth/signup/verify", { method: "POST", body: form }),
    );
    assert.equal(replay.status, 303);
    assert.equal(new URL(replay.headers.get("location")!).searchParams.get("error"), "signup_verification_invalid");
  } finally {
    await prisma.pendingSignup.deleteMany({ where: { id: pending.id } });
  }
});
