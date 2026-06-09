import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentHousehold } from "@/lib/auth/session";
import {
  changeHouseholdMemberRole,
  HouseholdMemberError,
  removeHouseholdMember,
} from "@/lib/household-members";
import { updateMembershipSchema } from "@/lib/validation/household";

type RouteContext = { params: Promise<{ id: string }> };

function memberError(error: HouseholdMemberError) {
  const status = error.code === "forbidden" ? 403 : error.code === "not_found" ? 404 : 409;
  return NextResponse.json({ error: { message: error.message } }, { status });
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await getCurrentHousehold();
  if (!auth) {
    return NextResponse.json({ error: { message: "Authentication required." } }, { status: 401 });
  }

  const parsed = updateMembershipSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { message: "Select a valid role." } }, { status: 400 });
  }

  try {
    const { id } = await context.params;
    const membership = await changeHouseholdMemberRole(auth, id, parsed.data.role);
    revalidatePath("/household");
    return NextResponse.json({ data: membership });
  } catch (error) {
    if (error instanceof HouseholdMemberError) return memberError(error);
    throw error;
  }
}

export async function DELETE(_: Request, context: RouteContext) {
  const auth = await getCurrentHousehold();
  if (!auth) {
    return NextResponse.json({ error: { message: "Authentication required." } }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const membership = await removeHouseholdMember(auth, id);
    revalidatePath("/household");
    return NextResponse.json({ data: membership });
  } catch (error) {
    if (error instanceof HouseholdMemberError) return memberError(error);
    throw error;
  }
}
