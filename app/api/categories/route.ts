import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentHousehold, hasHouseholdRole } from "@/lib/auth/session";
import { createCategorySchema } from "@/lib/validation/category";

export async function GET() {
  const auth = await getCurrentHousehold();

  if (!auth) {
    return NextResponse.json(
      { error: { message: "Authentication required." } },
      { status: 401 },
    );
  }

  const categories = await prisma.category.findMany({
    where: { householdId: auth.householdId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({ data: categories });
}

export async function POST(request: Request) {
  const auth = await getCurrentHousehold();

  if (!auth) {
    return NextResponse.json(
      { error: { message: "Authentication required." } },
      { status: 401 },
    );
  }

  if (!hasHouseholdRole(auth, ["OWNER", "ADMIN"])) {
    return NextResponse.json(
      { error: { message: "Admin access required." } },
      { status: 403 },
    );
  }

  const payload = await request.json().catch(() => null);
  const parsed = createCategorySchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: parsed.error.issues[0]?.message ?? "Invalid category data." } },
      { status: 400 },
    );
  }

  const existingCategory = await prisma.category.findUnique({
    where: {
      householdId_name: {
        householdId: auth.householdId,
        name: parsed.data.name,
      },
    },
  });

  if (existingCategory) {
    return NextResponse.json(
      { error: { message: "Category already exists." } },
      { status: 409 },
    );
  }

  const lastCategory = await prisma.category.findFirst({
    where: { householdId: auth.householdId },
    orderBy: { sortOrder: "desc" },
  });

  const category = await prisma.category.create({
    data: {
      householdId: auth.householdId,
      name: parsed.data.name,
      sortOrder: (lastCategory?.sortOrder ?? -1) + 1,
    },
  });

  return NextResponse.json({ data: category }, { status: 201 });
}
