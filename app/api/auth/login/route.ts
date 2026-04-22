import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { createSession } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { loginSchema } from "@/lib/validation/auth";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          message: parsed.error.issues[0]?.message ?? "Invalid login request.",
        },
      },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({
    where: {
      email: parsed.data.email,
    },
  });

  if (!user) {
    return NextResponse.json(
      {
        error: {
          message: "Invalid email or password.",
        },
      },
      { status: 401 },
    );
  }

  const isValidPassword = await verifyPassword(parsed.data.password, user.passwordHash);

  if (!isValidPassword) {
    return NextResponse.json(
      {
        error: {
          message: "Invalid email or password.",
        },
      },
      { status: 401 },
    );
  }

  await createSession(user.id);

  return NextResponse.json({
    data: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    },
  });
}
