import { NextResponse } from "next/server";
import { clearSession, getCurrentHousehold, getCurrentUser } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";

export async function POST() {
  const auth = await getCurrentHousehold();
  const user = auth?.user ?? (await getCurrentUser());

  await clearSession();
  await writeAuditLog({
    userId: user?.id ?? null,
    householdId: auth?.householdId ?? null,
    action: "auth.logout",
  });

  return NextResponse.json({
    data: {
      success: true,
    },
  });
}
