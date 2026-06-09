import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { HouseholdRole } from "@prisma/client";
import { prisma } from "../lib/db/prisma";
import type { AuthContext } from "../lib/auth/session";
import {
  acceptHouseholdInviteForUser,
  createHouseholdInvite,
  createInviteToken,
  hashInviteToken,
  InviteAcceptanceError,
  reserveInviteAcceptanceOrThrow,
  revokeHouseholdInvite,
  auditInviteFailure,
} from "../lib/household-invites";
import {
  INVITE_ACCEPTANCE_ACTOR_TOKEN_LIMIT,
  INVITE_ACCEPTANCE_TOKEN_LIMIT,
  INVITE_ACCEPTANCE_USER_LIMIT,
  INVITE_CREATION_LIMIT,
  INVITE_LOOKUP_ACTOR_LIMIT,
  INVITE_LOOKUP_TOKEN_LIMIT,
  cleanupInviteRateLimitAttempts,
  getInviteAcceptanceTokenLimit,
  getInviteLookupTokenLimit,
  reserveInviteAcceptanceAttempt,
  reserveInviteCreationAttempt,
  reserveInviteLookupAttempt,
} from "../lib/invite-rate-limit";
import {
  changeHouseholdMemberRole,
  HouseholdMemberError,
  removeHouseholdMember,
} from "../lib/household-members";
import { softDeleteExpenseForUser, updateExpenseForUser } from "../lib/expenses";
import { assertSafeTestDatabase } from "./helpers/test-database";

assertSafeTestDatabase();
const integrationTest = test;

type Fixture = Awaited<ReturnType<typeof createFixture>>;
type UserKey =
  | "owner"
  | "admin"
  | "member"
  | "otherMember"
  | "viewer"
  | "invited"
  | "restricted"
  | "outsider";

function makeAuth(
  fixture: {
    household: { id: string; name: string };
    users: Record<string, { id: string; name: string; email: string; role: "ADMIN" | "USER" }>;
  },
  key: UserKey,
  householdRole: HouseholdRole,
): AuthContext {
  const user = fixture.users[key];
  return {
    user,
    householdId: fixture.household.id,
    householdName: fixture.household.name,
    householdRole,
    households: [{ id: fixture.household.id, name: fixture.household.name, role: householdRole }],
  };
}

async function createFixture() {
  const startedAt = new Date();
  const suffix = crypto.randomUUID();
  const users = {
    owner: await prisma.user.create({ data: { name: "Owner", email: `owner-${suffix}@example.com` } }),
    admin: await prisma.user.create({ data: { name: "Admin", email: `admin-${suffix}@example.com` } }),
    member: await prisma.user.create({ data: { name: "Member", email: `member-${suffix}@example.com` } }),
    otherMember: await prisma.user.create({ data: { name: "Other Member", email: `other-${suffix}@example.com` } }),
    viewer: await prisma.user.create({ data: { name: "Viewer", email: `viewer-${suffix}@example.com` } }),
    invited: await prisma.user.create({ data: { name: "Invited", email: `invited-${suffix}@example.com` } }),
    restricted: await prisma.user.create({ data: { name: "Restricted", email: `restricted-${suffix}@example.com` } }),
    outsider: await prisma.user.create({ data: { name: "Outsider", email: `outsider-${suffix}@example.com` } }),
  };
  const household = await prisma.household.create({ data: { name: `Phase 3 ${suffix}` } });
  const otherHousehold = await prisma.household.create({ data: { name: `Other ${suffix}` } });

  const memberships = {
    owner: await prisma.membership.create({ data: { userId: users.owner.id, householdId: household.id, role: "OWNER" } }),
    admin: await prisma.membership.create({ data: { userId: users.admin.id, householdId: household.id, role: "ADMIN" } }),
    member: await prisma.membership.create({ data: { userId: users.member.id, householdId: household.id, role: "MEMBER" } }),
    otherMember: await prisma.membership.create({ data: { userId: users.otherMember.id, householdId: household.id, role: "MEMBER" } }),
    viewer: await prisma.membership.create({ data: { userId: users.viewer.id, householdId: household.id, role: "VIEWER" } }),
    outsider: await prisma.membership.create({ data: { userId: users.outsider.id, householdId: otherHousehold.id, role: "OWNER" } }),
  };
  const category = await prisma.category.create({ data: { householdId: household.id, name: `Phase 3 ${suffix}` } });
  const otherCategory = await prisma.category.create({ data: { householdId: otherHousehold.id, name: `Other ${suffix}` } });
  const expenses = {
    member: await prisma.expense.create({
      data: {
        userId: users.member.id,
        householdId: household.id,
        categoryId: category.id,
        invoiceNumber: "MEMBER-OWN",
        invoiceDate: new Date("2026-06-01T00:00:00.000Z"),
        amount: 10,
        filePath: "uploads/member.pdf",
      },
    }),
    otherMember: await prisma.expense.create({
      data: {
        userId: users.otherMember.id,
        householdId: household.id,
        categoryId: category.id,
        invoiceNumber: "OTHER-MEMBER",
        invoiceDate: new Date("2026-06-01T00:00:00.000Z"),
        amount: 20,
        filePath: "uploads/other-member.pdf",
      },
    }),
    outsider: await prisma.expense.create({
      data: {
        userId: users.outsider.id,
        householdId: otherHousehold.id,
        categoryId: otherCategory.id,
        invoiceNumber: "OUTSIDER",
        invoiceDate: new Date("2026-06-01T00:00:00.000Z"),
        amount: 30,
        filePath: "uploads/outsider.pdf",
      },
    }),
  };

  return {
    startedAt,
    users,
    household,
    otherHousehold,
    memberships,
    category,
    otherCategory,
    expenses,
    auth: {
      owner: makeAuth({ household, users }, "owner", "OWNER"),
      admin: makeAuth({ household, users }, "admin", "ADMIN"),
      member: makeAuth({ household, users }, "member", "MEMBER"),
      viewer: makeAuth({ household, users }, "viewer", "VIEWER"),
      outsider: {
        ...makeAuth({ household: otherHousehold, users }, "outsider", "OWNER"),
      },
    },
  };
}

async function cleanupFixture(fixture: Fixture) {
  assertSafeTestDatabase();
  const householdIds = [fixture.household.id, fixture.otherHousehold.id];
  const userIds = Object.values(fixture.users).map((user) => user.id);
  await prisma.inviteRateLimitAttempt.deleteMany({
    where: { createdAt: { gte: fixture.startedAt } },
  });
  await prisma.auditLog.deleteMany({ where: { OR: [{ householdId: { in: householdIds } }, { userId: { in: userIds } }] } });
  await prisma.householdInvite.deleteMany({ where: { householdId: { in: householdIds } } });
  await prisma.expense.deleteMany({ where: { householdId: { in: householdIds } } });
  await prisma.category.deleteMany({ where: { householdId: { in: householdIds } } });
  await prisma.membership.deleteMany({ where: { householdId: { in: householdIds } } });
  await prisma.household.deleteMany({ where: { id: { in: householdIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

before(async () => {
  await prisma.$connect();
});

after(async () => {
  await prisma.$disconnect();
});

integrationTest("OWNER and ADMIN invite limits are enforced and raw tokens are never stored", async () => {
  const fixture = await createFixture();
  try {
    const ownerInvite = await createHouseholdInvite(fixture.auth.owner, {
      role: "ADMIN",
      expiresInDays: 7,
      maxUses: 1,
    });
    const stored = await prisma.householdInvite.findUniqueOrThrow({ where: { id: ownerInvite.invite.id } });
    assert.equal(stored.tokenHash, hashInviteToken(ownerInvite.token));
    assert.notEqual(stored.tokenHash, ownerInvite.token);

    await assert.rejects(
      createHouseholdInvite(fixture.auth.admin, {
        role: "ADMIN",
        expiresInDays: 7,
        maxUses: 1,
      }),
      (error: unknown) =>
        error instanceof InviteAcceptanceError && error.reason === "inviter_not_authorized",
    );

    const adminInvite = await createHouseholdInvite(fixture.auth.admin, {
      role: "MEMBER",
      expiresInDays: 7,
      maxUses: 1,
    });
    assert.equal(adminInvite.invite.role, "MEMBER");
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("invite acceptance rejects duplicate, expired, revoked, and wrong-email attempts", async () => {
  const fixture = await createFixture();
  try {
    const acceptedInvite = await createHouseholdInvite(fixture.auth.owner, {
      email: fixture.users.invited.email,
      role: "VIEWER",
      expiresInDays: 7,
      maxUses: 2,
    });
    const accepted = await acceptHouseholdInviteForUser(acceptedInvite.token, fixture.users.invited);
    assert.equal(accepted.ok, true);
    assert.equal(
      (await prisma.membership.findUniqueOrThrow({
        where: { userId_householdId: { userId: fixture.users.invited.id, householdId: fixture.household.id } },
      })).role,
      "VIEWER",
    );

    const duplicate = await acceptHouseholdInviteForUser(acceptedInvite.token, fixture.users.invited);
    assert.deepEqual(duplicate, {
      ok: false,
      reason: "duplicate_membership",
      householdId: fixture.household.id,
    });

    const wrongEmail = await acceptHouseholdInviteForUser(
      acceptedInvite.token,
      fixture.users.restricted,
    );
    assert.equal(wrongEmail.ok, false);
    if (!wrongEmail.ok) assert.equal(wrongEmail.reason, "email_mismatch");

    const expiredToken = createInviteToken();
    await prisma.householdInvite.create({
      data: {
        householdId: fixture.household.id,
        tokenHash: hashInviteToken(expiredToken),
        role: "MEMBER",
        expiresAt: new Date(Date.now() - 60_000),
        createdByUserId: fixture.users.owner.id,
      },
    });
    const expired = await acceptHouseholdInviteForUser(expiredToken, fixture.users.restricted);
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.equal(expired.reason, "expired");

    const revokedInvite = await createHouseholdInvite(fixture.auth.owner, {
      role: "MEMBER",
      expiresInDays: 7,
      maxUses: 1,
    });
    await revokeHouseholdInvite(fixture.auth.owner, revokedInvite.invite.id);
    const revoked = await acceptHouseholdInviteForUser(revokedInvite.token, fixture.users.restricted);
    assert.equal(revoked.ok, false);
    if (!revoked.ok) assert.equal(revoked.reason, "revoked");

    const actions = await prisma.auditLog.findMany({
      where: { householdId: fixture.household.id },
      select: { action: true },
    });
    assert.ok(actions.some((entry) => entry.action === "household.invite.created"));
    assert.ok(actions.some((entry) => entry.action === "household.invite.accepted"));
    assert.ok(actions.some((entry) => entry.action === "household.invite.revoked"));
    assert.ok(actions.some((entry) => entry.action === "household.invite.expired"));
    assert.ok(actions.some((entry) => entry.action === "household.invite.accept_failed"));
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("parallel invite reservations cannot exceed atomic database limits", async () => {
  const fixture = await createFixture();
  try {
    const creationResults = await Promise.all(
      Array.from({ length: INVITE_CREATION_LIMIT + 10 }, () =>
        reserveInviteCreationAttempt(fixture.household.id, fixture.users.owner.id),
      ),
    );
    assert.equal(
      creationResults.filter(Boolean).length,
      INVITE_CREATION_LIMIT,
    );

    const acceptanceTokenHash = hashInviteToken(createInviteToken());
    const acceptanceActors = [`user:${fixture.users.invited.id}`];
    const acceptanceResults = await Promise.all(
      Array.from({ length: INVITE_ACCEPTANCE_ACTOR_TOKEN_LIMIT + 10 }, () =>
        reserveInviteAcceptanceAttempt(acceptanceTokenHash, acceptanceActors),
      ),
    );
    assert.equal(
      acceptanceResults.filter(Boolean).length,
      INVITE_ACCEPTANCE_ACTOR_TOKEN_LIMIT,
    );

    const noActorAcceptanceTokenHash = hashInviteToken(createInviteToken());
    const noActorAcceptanceResults = await Promise.all(
      Array.from({ length: INVITE_ACCEPTANCE_TOKEN_LIMIT + 10 }, () =>
        reserveInviteAcceptanceAttempt(noActorAcceptanceTokenHash, []),
      ),
    );
    assert.equal(
      noActorAcceptanceResults.filter(Boolean).length,
      INVITE_ACCEPTANCE_TOKEN_LIMIT,
    );

    const randomAcceptanceActors = [`user:${fixture.users.restricted.id}`];
    const randomAcceptanceResults = await Promise.all(
      Array.from({ length: INVITE_ACCEPTANCE_USER_LIMIT + 10 }, () =>
        reserveInviteAcceptanceAttempt(
          hashInviteToken(createInviteToken()),
          randomAcceptanceActors,
        ),
      ),
    );
    assert.equal(
      randomAcceptanceResults.filter(Boolean).length,
      INVITE_ACCEPTANCE_USER_LIMIT,
    );

    const lookupActors = [`user:${fixture.users.restricted.id}`];
    const lookupResults = await Promise.all(
      Array.from({ length: INVITE_LOOKUP_ACTOR_LIMIT + 10 }, () =>
        reserveInviteLookupAttempt(hashInviteToken(createInviteToken()), lookupActors),
      ),
    );
    assert.equal(lookupResults.filter(Boolean).length, INVITE_LOOKUP_ACTOR_LIMIT);

    const anonymousActorOne = ["fingerprint:anonymous-browser-one"];
    const anonymousActorTwo = ["fingerprint:anonymous-browser-two"];
    const anonymousActorOneResults = await Promise.all(
      Array.from({ length: INVITE_LOOKUP_ACTOR_LIMIT }, () =>
        reserveInviteLookupAttempt(hashInviteToken(createInviteToken()), anonymousActorOne),
      ),
    );
    assert.equal(anonymousActorOneResults.filter(Boolean).length, INVITE_LOOKUP_ACTOR_LIMIT);
    assert.equal(
      await reserveInviteLookupAttempt(hashInviteToken(createInviteToken()), anonymousActorOne),
      false,
    );
    assert.equal(
      await reserveInviteLookupAttempt(hashInviteToken(createInviteToken()), anonymousActorTwo),
      true,
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("shared onboarding invite acceptance reservation rejects over-limit attempts", async () => {
  const fixture = await createFixture();
  try {
    const tokenHash = hashInviteToken(createInviteToken());
    const actorKeys = [`email:${fixture.users.invited.email}`];

    for (let index = 0; index < INVITE_ACCEPTANCE_ACTOR_TOKEN_LIMIT; index += 1) {
      await reserveInviteAcceptanceOrThrow(tokenHash, actorKeys);
    }

    await assert.rejects(
      reserveInviteAcceptanceOrThrow(tokenHash, actorKeys),
      (error: unknown) =>
        error instanceof InviteAcceptanceError && error.reason === "rate_limited",
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("parallel multi-use invite acceptance consumes every available use exactly once", async () => {
  const fixture = await createFixture();
  const maxUses = 12;
  const candidates = await Promise.all(
    Array.from({ length: maxUses + 3 }, (_, index) =>
      prisma.user.create({
        data: {
          name: `Parallel Invite ${index}`,
          email: `parallel-invite-${index}-${crypto.randomUUID()}@example.com`,
        },
      }),
    ),
  );

  try {
    const { invite, token } = await createHouseholdInvite(fixture.auth.owner, {
      role: "MEMBER",
      expiresInDays: 7,
      maxUses,
    });

    const results = await Promise.all(
      candidates.map((user) =>
        acceptHouseholdInviteForUser(token, user, [`user:${user.id}`]),
      ),
    );
    const accepted = results.filter((result) => result.ok);
    const rejected = results.filter((result) => !result.ok);

    assert.equal(accepted.length, maxUses);
    assert.equal(rejected.length, candidates.length - maxUses);
    assert.ok(rejected.every((result) => !result.ok && result.reason === "used_up"));

    const storedInvite = await prisma.householdInvite.findUniqueOrThrow({
      where: { id: invite.id },
    });
    assert.equal(storedInvite.usedCount, maxUses);
    assert.ok(storedInvite.usedCount <= storedInvite.maxUses);

    const memberships = await prisma.membership.findMany({
      where: {
        householdId: fixture.household.id,
        userId: { in: candidates.map((user) => user.id) },
        removedAt: null,
      },
      select: { userId: true },
    });
    assert.equal(memberships.length, maxUses);
    assert.equal(new Set(memberships.map((membership) => membership.userId)).size, maxUses);
  } finally {
    await cleanupFixture(fixture);
    await prisma.user.deleteMany({
      where: { id: { in: candidates.map((user) => user.id) } },
    });
  }
});

integrationTest("100-use invite admits 100 unique users to acceptance and rejects the 101st", async () => {
  const fixture = await createFixture();
  const maxUses = 100;
  const candidates = await Promise.all(
    Array.from({ length: maxUses + 1 }, (_, index) =>
      prisma.user.create({
        data: {
          name: `Capacity Invite ${index}`,
          email: `capacity-${index}-${crypto.randomUUID()}@example.com`,
        },
      }),
    ),
  );

  try {
    const { invite, token } = await createHouseholdInvite(fixture.auth.owner, {
      role: "MEMBER",
      expiresInDays: 7,
      maxUses,
    });

    const accepted: typeof candidates = [];
    for (let index = 0; index < maxUses; index += 1) {
      const candidate = candidates[index];
      const result = await acceptHouseholdInviteForUser(token, candidate, [
        `user:${candidate.id}`,
        `fingerprint:capacity-${index}`,
        `ip:10.0.0.${index % 250 + 1}`,
      ]);
      assert.equal(
        result.ok,
        true,
        `User ${index} (id=${candidate.id}) should accept the 100-use invite. result=${JSON.stringify(result)}`,
      );
      accepted.push(candidate);
    }

    const rejection = await acceptHouseholdInviteForUser(
      token,
      candidates[maxUses],
      [
        `user:${candidates[maxUses].id}`,
        `fingerprint:capacity-${maxUses}`,
        `ip:10.0.0.${(maxUses % 250) + 1}`,
      ],
    );
    assert.equal(rejection.ok, false);
    if (!rejection.ok) {
      assert.equal(rejection.reason, "used_up");
    }

    const stored = await prisma.householdInvite.findUniqueOrThrow({
      where: { id: invite.id },
    });
    assert.equal(stored.usedCount, maxUses);
    assert.ok(stored.usedCount <= stored.maxUses);

    const memberships = await prisma.membership.findMany({
      where: {
        householdId: fixture.household.id,
        userId: { in: accepted.map((user) => user.id) },
        removedAt: null,
      },
      select: { userId: true },
    });
    assert.equal(memberships.length, maxUses);
    assert.equal(
      new Set(memberships.map((membership) => membership.userId)).size,
      maxUses,
    );
  } finally {
    await cleanupFixture(fixture);
    await prisma.user.deleteMany({
      where: { id: { in: candidates.map((user) => user.id) } },
    });
  }
});

integrationTest("invalid/random token probing is still rate-limited and never leaks valid-invite budgets", async () => {
  const fixture = await createFixture();
  try {
    const probingActor = [`fingerprint:probing-${crypto.randomUUID()}`];

    // Probing actor hits the strict per-actor limit before any token-wide effect.
    let probingActorAllowed = 0;
    for (let index = 0; index < INVITE_LOOKUP_ACTOR_LIMIT + 5; index += 1) {
      const granted = await reserveInviteLookupAttempt(
        hashInviteToken(createInviteToken()),
        probingActor,
      );
      if (granted) probingActorAllowed += 1;
    }
    assert.equal(probingActorAllowed, INVITE_LOOKUP_ACTOR_LIMIT);

    // The token-wide cap for unknown/random tokens stays at the strict default.
    const phantomTokenHash = hashInviteToken(createInviteToken());
    let tokenWideAllowed = 0;
    for (let index = 0; index < INVITE_LOOKUP_TOKEN_LIMIT + 5; index += 1) {
      const granted = await reserveInviteLookupAttempt(phantomTokenHash, [
        `fingerprint:phantom-${index}-${crypto.randomUUID()}`,
      ]);
      if (granted) tokenWideAllowed += 1;
    }
    assert.equal(tokenWideAllowed, INVITE_LOOKUP_TOKEN_LIMIT);

    // The next phantom lookup against the same unknown token is rejected, proving
    // the token-wide invalid-lookup cap is still active.
    assert.equal(
      await reserveInviteLookupAttempt(phantomTokenHash, [
        `fingerprint:phantom-final-${crypto.randomUUID()}`,
      ]),
      false,
    );

    // A separate, unrelated valid-token probe by a fresh actor still works:
    // anonymous probing of one token must not globally block other tokens.
    assert.equal(
      await reserveInviteLookupAttempt(
        hashInviteToken(createInviteToken()),
        [`fingerprint:fresh-${crypto.randomUUID()}`],
        { acceptableMaxUses: 100 },
      ),
      true,
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("invite lookup/acceptance budgets scale with maxUses for known invites", async () => {
  const fixture = await createFixture();
  try {
    // Regression for the 60-limit blocker: a maxUses=100 invite must allow
    // > 60 lookups (the old INVITE_LOOKUP_TOKEN_LIMIT cap). The new dynamic
    // budget keeps the strict default for unknown tokens but scales for
    // tokens that correspond to a real invite.
    assert.equal(getInviteLookupTokenLimit(null), INVITE_LOOKUP_TOKEN_LIMIT);
    assert.equal(getInviteLookupTokenLimit(0), INVITE_LOOKUP_TOKEN_LIMIT);
    assert.equal(getInviteLookupTokenLimit(1), INVITE_LOOKUP_TOKEN_LIMIT);
    assert.ok(getInviteLookupTokenLimit(100) >= 100);
    assert.ok(getInviteLookupTokenLimit(100) > INVITE_LOOKUP_TOKEN_LIMIT);
    assert.ok(getInviteLookupTokenLimit(70) > INVITE_LOOKUP_TOKEN_LIMIT);

    assert.equal(getInviteAcceptanceTokenLimit(null), INVITE_ACCEPTANCE_TOKEN_LIMIT);
    assert.ok(getInviteAcceptanceTokenLimit(100) >= 100);

    // End-to-end: with the scaled budget, well over 60 lookup attempts succeed
    // for a known invite from distinct actors against the same token.
    const scaledTokenHash = hashInviteToken(createInviteToken());
    const sampleCount = INVITE_LOOKUP_TOKEN_LIMIT + 20;
    let scaledAllowed = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      const granted = await reserveInviteLookupAttempt(
        scaledTokenHash,
        [`fingerprint:scaled-${index}-${crypto.randomUUID()}`],
        { acceptableMaxUses: 100 },
      );
      if (granted) scaledAllowed += 1;
    }
    assert.equal(scaledAllowed, sampleCount);
    assert.ok(scaledAllowed > INVITE_LOOKUP_TOKEN_LIMIT);

    // Without the scaled hint (token treated as unknown), the same token would
    // have hit the strict cap by now. Verify the strict default still rejects.
    assert.equal(
      await reserveInviteLookupAttempt(scaledTokenHash, [
        `fingerprint:strict-${crypto.randomUUID()}`,
      ]),
      false,
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("parallel repeated invite failures create only one audit row per throttle window", async () => {
  const fixture = await createFixture();
  try {
    const tokenHash = hashInviteToken(createInviteToken());
    const input = {
      actionUserId: fixture.users.invited.id,
      householdId: fixture.household.id,
      reason: "expired" as const,
      tokenHash,
      inviteId: crypto.randomUUID(),
      source: "integration_test",
    };

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        auditInviteFailure({
          ...input,
          actionUserId:
            index % 2 === 0 ? fixture.users.invited.id : fixture.users.restricted.id,
        }),
      ),
    );
    assert.equal(results.filter(Boolean).length, 1);

    assert.equal(
      await prisma.auditLog.count({
        where: {
          householdId: fixture.household.id,
          action: "household.invite.expired",
        },
      }),
      1,
    );
  } finally {
    await prisma.inviteRateLimitAttempt.deleteMany({ where: { action: "cleanup-test" } });
    await cleanupFixture(fixture);
  }
});

integrationTest("invite limiter cleanup removes only rows older than retention boundary", async () => {
  const fixture = await createFixture();
  try {
    const boundary = new Date("2026-06-01T00:00:00.000Z");
    await prisma.inviteRateLimitAttempt.createMany({
      data: [
        {
          action: "cleanup-test",
          keyHash: hashInviteToken("old"),
          createdAt: new Date("2026-05-31T23:59:59.000Z"),
        },
        {
          action: "cleanup-test",
          keyHash: hashInviteToken("recent"),
          createdAt: boundary,
        },
      ],
    });

    assert.equal((await cleanupInviteRateLimitAttempts(boundary)).count, 1);
    assert.equal(
      await prisma.inviteRateLimitAttempt.count({
        where: { action: "cleanup-test", createdAt: { gte: boundary } },
      }),
      1,
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("OWNER manages members, ADMIN cannot, and the only owner is protected", async () => {
  const fixture = await createFixture();
  try {
    const changed = await changeHouseholdMemberRole(
      fixture.auth.owner,
      fixture.memberships.member.id,
      "ADMIN",
    );
    assert.equal(changed.role, "ADMIN");

    await assert.rejects(
      changeHouseholdMemberRole(fixture.auth.admin, fixture.memberships.otherMember.id, "VIEWER"),
      (error: unknown) => error instanceof HouseholdMemberError && error.code === "forbidden",
    );
    await assert.rejects(
      removeHouseholdMember(fixture.auth.admin, fixture.memberships.otherMember.id),
      (error: unknown) => error instanceof HouseholdMemberError && error.code === "forbidden",
    );
    await assert.rejects(
      removeHouseholdMember(fixture.auth.owner, fixture.memberships.owner.id),
      (error: unknown) => error instanceof HouseholdMemberError && error.code === "last_owner",
    );

    const removed = await removeHouseholdMember(
      fixture.auth.owner,
      fixture.memberships.otherMember.id,
    );
    assert.ok(removed.removedAt);
    assert.equal(
      await prisma.membership.count({
        where: { id: fixture.memberships.otherMember.id, removedAt: null },
      }),
      0,
    );
    assert.equal(
      await prisma.expense.count({ where: { id: fixture.expenses.otherMember.id } }),
      1,
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("parallel owner removal and demotion always leave an active owner", async () => {
  const fixture = await createFixture();
  try {
    await prisma.membership.update({
      where: { id: fixture.memberships.otherMember.id },
      data: { role: "OWNER" },
    });

    const results = await Promise.allSettled([
      removeHouseholdMember(fixture.auth.owner, fixture.memberships.owner.id),
      changeHouseholdMemberRole(
        fixture.auth.owner,
        fixture.memberships.otherMember.id,
        "MEMBER",
      ),
    ]);

    assert.equal(
      await prisma.membership.count({
        where: { householdId: fixture.household.id, role: "OWNER", removedAt: null },
      }),
      1,
    );
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("ADMIN can revoke lower-role invites but not ADMIN invites", async () => {
  const fixture = await createFixture();
  try {
    const adminInvite = await createHouseholdInvite(fixture.auth.owner, {
      role: "ADMIN",
      expiresInDays: 7,
      maxUses: 1,
    });
    const memberInvite = await createHouseholdInvite(fixture.auth.owner, {
      role: "MEMBER",
      expiresInDays: 7,
      maxUses: 1,
    });

    await assert.rejects(
      revokeHouseholdInvite(fixture.auth.admin, adminInvite.invite.id),
      (error: unknown) =>
        error instanceof InviteAcceptanceError && error.reason === "inviter_not_authorized",
    );
    assert.equal(
      (await prisma.householdInvite.findUniqueOrThrow({
        where: { id: adminInvite.invite.id },
      })).revokedAt,
      null,
    );

    assert.ok(await revokeHouseholdInvite(fixture.auth.admin, memberInvite.invite.id));
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("database constraints reject OWNER invites and overused invites", async () => {
  const fixture = await createFixture();
  try {
    await assert.rejects(
      prisma.householdInvite.create({
        data: {
          householdId: fixture.household.id,
          tokenHash: hashInviteToken(createInviteToken()),
          role: "OWNER",
          expiresAt: new Date(Date.now() + 60_000),
          createdByUserId: fixture.users.owner.id,
        },
      }),
    );
    await assert.rejects(
      prisma.householdInvite.create({
        data: {
          householdId: fixture.household.id,
          tokenHash: hashInviteToken(createInviteToken()),
          role: "MEMBER",
          maxUses: 1,
          usedCount: 2,
          expiresAt: new Date(Date.now() + 60_000),
          createdByUserId: fixture.users.owner.id,
        },
      }),
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("expense mutation roles and household isolation are enforced in the data layer", async () => {
  const fixture = await createFixture();
  try {
    assert.ok(
      await updateExpenseForUser(
        fixture.auth.member,
        fixture.expenses.member.id,
        { invoiceNumber: "MEMBER-UPDATED" },
      ),
    );
    assert.equal(
      await updateExpenseForUser(
        fixture.auth.member,
        fixture.expenses.otherMember.id,
        { invoiceNumber: "FORBIDDEN" },
      ),
      null,
    );
    assert.ok(
      await updateExpenseForUser(
        fixture.auth.admin,
        fixture.expenses.otherMember.id,
        { invoiceNumber: "ADMIN-UPDATED" },
      ),
    );
    assert.equal(
      await updateExpenseForUser(
        fixture.auth.viewer,
        fixture.expenses.member.id,
        { invoiceNumber: "VIEWER-FORBIDDEN" },
      ),
      null,
    );
    assert.equal(
      await softDeleteExpenseForUser(
        fixture.auth.outsider,
        fixture.expenses.member.id,
        fixture.users.outsider.id,
      ),
      null,
    );
    assert.ok(
      await softDeleteExpenseForUser(
        fixture.auth.owner,
        fixture.expenses.otherMember.id,
        fixture.users.owner.id,
      ),
    );
  } finally {
    await cleanupFixture(fixture);
  }
});
