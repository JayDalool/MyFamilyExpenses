import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentHousehold, hasHouseholdRole } from "@/lib/auth/session";
import { updateCategorySchema } from "@/lib/validation/category";
import { writeAuditLog } from "@/lib/audit";
import {
  deleteOrDisableCategoryForHousehold,
  updateCategoryForHousehold,
} from "@/lib/categories";
import { revalidateCategoryViews } from "@/lib/revalidation";

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

  const updatedCategory = await updateCategoryForHousehold(
    auth.householdId,
    id,
    parsed.data,
  );

  if (!updatedCategory) {
    return NextResponse.json(
      { error: { message: "Category not found." } },
      { status: 404 },
    );
  }

  const action =
    parsed.data.status === "DISABLED"
      ? "category.disable"
      : parsed.data.status === "ACTIVE"
        ? "category.enable"
        : "category.update";
  await writeAuditLog({
    userId: auth.user.id,
    householdId: auth.householdId,
    action,
    metadata: { categoryId: id, changes: parsed.data },
  });
  revalidateCategoryViews();

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

  const result = await deleteOrDisableCategoryForHousehold(auth.householdId, id);

  if (!result) {
    return NextResponse.json(
      { error: { message: "Category not found." } },
      { status: 404 },
    );
  }

  const action = result.mode === "deleted" ? "category.delete" : "category.disable";

  await writeAuditLog({
    userId: auth.user.id,
    householdId: auth.householdId,
    action,
    metadata: {
      categoryId: id,
      name: category.name,
      mode: result.mode === "deleted" ? "hard_delete" : "disabled_in_use",
      expenseCount: result.expenseCount,
    },
  });
  revalidateCategoryViews();

  return NextResponse.json({ data: result.category, meta: { mode: result.mode } });
}
