import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  getCurrentUser,
  setActiveHouseholdCookie,
} from "@/lib/auth/session";
import { acceptHouseholdInviteForUser } from "@/lib/household-invites";
import { getInviteRequestActorKeys } from "@/lib/invite-rate-limit";

type RouteContext = { params: Promise<{ token: string }> };

const FAILURE_MESSAGES = {
  not_found: "This invite is unavailable.",
  expired: "This invite is unavailable.",
  revoked: "This invite is unavailable.",
  used_up: "This invite is unavailable.",
  email_mismatch: "This invite is unavailable.",
  duplicate_membership: "You already belong to this household.",
  inviter_not_authorized: "This invite is unavailable.",
  rate_limited: "Too many invite acceptance attempts. Please try again later.",
} as const;

export async function POST(request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { message: "Authentication required." } }, { status: 401 });
  }

  const { token } = await context.params;
  const result = await acceptHouseholdInviteForUser(
    token,
    user,
    getInviteRequestActorKeys(request, { userId: user.id, email: user.email }),
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: { message: FAILURE_MESSAGES[result.reason] } },
      {
        status:
          result.reason === "rate_limited"
            ? 429
            : result.reason === "duplicate_membership"
              ? 409
              : 400,
      },
    );
  }

  await setActiveHouseholdCookie(result.householdId);
  revalidatePath("/dashboard");
  revalidatePath("/household");
  return NextResponse.json({ data: result });
}
