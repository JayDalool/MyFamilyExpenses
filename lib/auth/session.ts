import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import type { HouseholdRole } from "@prisma/client";
import { getValidatedSessionSecret } from "@/lib/auth/session-secret";
import { shouldUseSecureCookies } from "@/lib/auth/cookies";

type AppRole = "ADMIN" | "USER";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: AppRole;
};

export type AuthContext = {
  user: CurrentUser;
  householdId: string;
  householdName: string;
  householdRole: HouseholdRole;
  households: HouseholdOption[];
};

export type HouseholdOption = {
  id: string;
  name: string;
  role: HouseholdRole;
};

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "mfe_session";
export const ACTIVE_HOUSEHOLD_COOKIE_NAME =
  process.env.ACTIVE_HOUSEHOLD_COOKIE_NAME ?? "mfe_household";
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? "7");

function getSessionExpiry() {
  return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

function hashSessionToken(token: string) {
  return crypto
    .createHmac("sha256", getValidatedSessionSecret(process.env.SESSION_SECRET))
    .update(token)
    .digest("hex");
}

export function createRawSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

export async function createSession(userId: string) {
  const token = createRawSessionToken();

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt: getSessionExpiry(),
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    path: "/",
    expires: getSessionExpiry(),
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await prisma.session.deleteMany({
      where: { tokenHash: hashSessionToken(token) },
    });
  }

  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    path: "/",
    maxAge: 0,
  });
  cookieStore.set(ACTIVE_HOUSEHOLD_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    path: "/",
    maxAge: 0,
  });
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  const session = await prisma.session.findFirst({
    where: {
      tokenHash: hashSessionToken(token),
      expiresAt: { gt: new Date() },
    },
    include: { user: true },
  });

  if (!session) {
    return null;
  }

  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: session.user.role,
  };
}

export async function getCurrentHousehold(): Promise<AuthContext | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const cookieStore = await cookies();
  const requestedHouseholdId = cookieStore.get(ACTIVE_HOUSEHOLD_COOKIE_NAME)?.value;
  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    include: { household: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const membership =
    memberships.find((item) => item.householdId === requestedHouseholdId) ?? memberships[0];
  if (!membership) return null;

  return {
    user,
    householdId: membership.householdId,
    householdName: membership.household.name,
    householdRole: membership.role,
    households: memberships.map((item) => ({
      id: item.householdId,
      name: item.household.name,
      role: item.role,
    })),
  };
}

export function hasHouseholdRole(auth: AuthContext, roles: HouseholdRole[]): boolean {
  return roles.includes(auth.householdRole);
}

export async function requireUser() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/auth/login");
  }

  return user;
}

export async function requireHouseholdMember(): Promise<AuthContext> {
  const auth = await getCurrentHousehold();

  if (!auth) {
    redirect("/auth/login");
  }

  return auth;
}
