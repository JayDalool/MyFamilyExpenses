import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentHousehold, hasHouseholdRole } from "@/lib/auth/session";
import { updateCategorySchema } from "@/lib/validation/category";
import { writeAuditLog } from "@/lib/audit";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

async function requireCategoryAdmin() {
  const auth = await getCurrentHousehold();

  if (!auth) {
    return {
      auth: null,
      response: NextResponse.json(
        { error: { message: "Authentication required." } },
        { status: 401 },
      ),
    };
  }

  if (!hasHouseholdRole(auth, ["OWNER", "ADMIN"])) {
    return {
      auth: null,
      response: NextResponse.json(
        { error: { message: "Admin access required." } },
        { status: 403 },
      ),
    };
  }

  return { auth, response: null };
}

export async function PATCH(request: Request, context: RouteContext) {
  const { auth, response } = await requireCategoryAdmin();
  if (!auth) return response;

  const { id } = await context.params;
  const payload = await request.json().catch(() => null);
  const parsed = updateCategorySchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: parsed.error.issues[0]?.message ?? "Invalid category data." } },
      { status: 400 },
    );
  }

  const category = await prisma.category.findFirst({
    where: { id, householdId: auth.householdId },
  });

  if (!category) {
    return NextResponse.json(
      { error: { message: "Category not found." } },
      { status: 404 },
    );
  }

  if (parsed.data.name && parsed.data.name !== category.name) {
    const duplicate = await prisma.category.findUnique({
      where: {
        householdId_name: {
          householdId: auth.householdId,
          name: parsed.data.name,
        },
      },
    });

    if (duplicate) {
      return NextResponse.json(
        { error: { message: "Category already exists." } },
        { status: 409 },
      );
    }
  }

  const updatedCategory = await prisma.category.update({
    where: { id },
    data: parsed.data,
  });

  await writeAuditLog({
    userId: auth.user.id,
    householdId: auth.householdId,
    action: "category.update",
    metadata: { categoryId: id, changes: parsed.data },
  });

  return NextResponse.json({ data: updatedCategory });
}

export async function DELETE(_: Request, context: RouteContext) {
  const { auth, response } = await requireCategoryAdmin();
  if (!auth) return response;

  const { id } = await context.params;
  const category = await prisma.category.findFirst({
    where: { id, householdId: auth.householdId },
  });

  if (!category) {
    return NextResponse.json(
      { error: { message: "Category not found." } },
      { status: 404 },
    );
  }

  const updatedCategory = await prisma.category.update({
    where: { id },
    data: { status: "DISABLED" },
  });

  await writeAuditLog({
    userId: auth.user.id,
    householdId: auth.householdId,
    action: "category.delete",
    metadata: { categoryId: id, name: category.name, mode: "soft_disable" },
  });

  return NextResponse.json({ data: updatedCategory });
}
