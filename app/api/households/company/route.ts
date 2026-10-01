import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser, setActiveHouseholdCookie } from "@/lib/auth/session";
import { buildDefaultCategories } from "@/lib/categories/default-categories";
import { writeAuditLog } from "@/lib/audit";

const createCompanySchema = z.object({
  name: z.string().trim().min(2, "Enter a company name").max(80, "Company name is too long"),
});

// Creates a COMPANY household for the signed-in user. The user becomes its OWNER
// and the new company becomes their active household. Existing households are untouched.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { message: "Authentication required." } }, { status: 401 });
  }

  const parsed = createCompanySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: parsed.error.issues[0]?.message ?? "Enter a company name." } },
      { status: 400 },
    );
  }

  const household = await prisma.$transaction(async (tx) => {
    const created = await tx.household.create({
      data: {
        name: parsed.data.name,
        kind: "COMPANY",
        memberships: { create: { userId: user.id, role: "OWNER" } },
      },
    });
    await tx.category.createMany({ data: buildDefaultCategories(created.id) });
    return created;
  });

  await setActiveHouseholdCookie(household.id);
  await writeAuditLog({
    userId: user.id,
    householdId: household.id,
    action: "household.company.create",
    metadata: { householdName: household.name },
  });

  return NextResponse.json({ data: { householdId: household.id, name: household.name } }, { status: 201 });
}
