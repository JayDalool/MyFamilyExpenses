import { prisma } from "@/lib/db/prisma";
import type { AuthProvider, Prisma } from "@prisma/client";
import { buildDefaultCategories } from "@/lib/categories/default-categories";

interface OAuthAccountInput {
  provider: AuthProvider;
  providerAccountId: string;
  providerEmail: string;
}

interface OnboardUserInput {
  name: string;
  email: string;
  passwordHash?: string | null;
  imageUrl?: string | null;
  emailVerifiedAt?: Date | null;
  oauthAccount?: OAuthAccountInput;
}

export interface OnboardedUser {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "USER";
  householdId: string;
}

type OnboardingDbClient = Prisma.TransactionClient | typeof prisma;

/**
 * Creates a new user, their default household, an OWNER membership, and
 * optionally an OAuth account — all in a single transaction.
 *
 * Called only from signup and OAuth callback routes. Normal login must NOT
 * call this; household creation is intentional only for new accounts.
 */
export async function onboardNewUser(input: OnboardUserInput): Promise<OnboardedUser> {
  return prisma.$transaction((tx) => onboardNewUserInTransaction(tx, input));
}

export async function onboardNewUserInTransaction(
  tx: OnboardingDbClient,
  input: OnboardUserInput,
): Promise<OnboardedUser> {
  const householdName = input.name.trim()
    ? `${input.name.trim()}'s Household`
    : "My Household";

  const household = await tx.household.create({
    data: { name: householdName },
  });

  const user = await tx.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash: input.passwordHash ?? null,
      imageUrl: input.imageUrl ?? null,
      emailVerifiedAt: input.emailVerifiedAt ?? null,
      memberships: {
        create: {
          householdId: household.id,
          role: "OWNER",
        },
      },
      ...(input.oauthAccount
        ? {
            authAccounts: {
              create: {
                provider: input.oauthAccount.provider,
                providerAccountId: input.oauthAccount.providerAccountId,
                providerEmail: input.oauthAccount.providerEmail,
              },
            },
          }
        : {}),
    },
  });

  await tx.category.createMany({
    data: buildDefaultCategories(household.id),
  });

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as "ADMIN" | "USER",
    householdId: household.id,
  };
}
