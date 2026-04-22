import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";

type AppRole = "ADMIN" | "USER";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: AppRole;
};

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "mfe_session";
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? "7");

function getSessionExpiry() {
  return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

function hashSessionToken(token: string) {
  return crypto
    .createHmac("sha256", process.env.SESSION_SECRET ?? "dev-session-secret")
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
    secure: process.env.NODE_ENV === "production",
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
    secure: process.env.NODE_ENV === "production",
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
      expiresAt: {
        gt: new Date(),
      },
    },
    include: {
      user: true,
    },
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

export async function requireUser() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/auth/login");
  }

  return user;
}

export async function requireAdmin() {
  const user = await requireUser();

  if (user.role !== "ADMIN") {
    redirect("/dashboard");
  }

  return user;
}
