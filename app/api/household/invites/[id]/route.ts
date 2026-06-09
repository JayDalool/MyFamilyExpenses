import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentHousehold } from "@/lib/auth/session";
import { InviteAcceptanceError, revokeHouseholdInvite } from "@/lib/household-invites";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_: Request, context: RouteContext) {
  const auth = await getCurrentHousehold();
  if (!auth) {
    return NextResponse.json({ error: { message: "Authentication required." } }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const invite = await revokeHouseholdInvite(auth, id);
    if (!invite) {
      return NextResponse.json({ error: { message: "Invite not found." } }, { status: 404 });
    }

    revalidatePath("/household");
    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    if (error instanceof InviteAcceptanceError) {
      return NextResponse.json(
        { error: { message: "Your household role cannot revoke invites." } },
        { status: 403 },
      );
    }
    throw error;
  }
}
