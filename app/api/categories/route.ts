import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentHousehold } from "@/lib/auth/session";
import { canManageCategories } from "@/lib/auth/permissions";
import { createCategorySchema } from "@/lib/validation/category";
import { writeAuditLog } from "@/lib/audit";
import { revalidateCategoryViews } from "@/lib/revalidation";
import {
  isNativeFormRequest,
  readJsonOrFormPayload,
  redirectNativeForm,
} from "@/lib/http/form-request";

function categoryErrorResponse(
  request: Request,
  message: string,
  status: number,
  errorCode: string,
) {
  if (isNativeFormRequest(request)) {
    return redirectNativeForm(request, `/categories?error=${errorCode}`);
  }

  return NextResponse.json({ error: { message } }, { status });
}

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
    return categoryErrorResponse(request, "Authentication required.", 401, "category_forbidden");
  }

  if (!canManageCategories(auth)) {
    return categoryErrorResponse(request, "Admin access required.", 403, "category_forbidden");
  }

  const payload = await readJsonOrFormPayload(request);
  const parsed = createCategorySchema.safeParse(payload);

  if (!parsed.success) {
    return categoryErrorResponse(
      request,
      parsed.error.issues[0]?.message ?? "Invalid category data.",
      400,
      "category_invalid",
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
    return categoryErrorResponse(request, "Category already exists.", 409, "category_exists");
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

  await writeAuditLog({
    userId: auth.user.id,
    householdId: auth.householdId,
    action: "category.create",
    metadata: { categoryId: category.id, name: category.name },
  });
  revalidateCategoryViews();

  if (isNativeFormRequest(request)) {
    return redirectNativeForm(request, "/categories?status=created");
  }

  return NextResponse.json({ data: category }, { status: 201 });
}
