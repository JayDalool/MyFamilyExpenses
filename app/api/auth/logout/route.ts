import { NextResponse } from "next/server";
import { clearSession, getCurrentHousehold } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";

export async function POST() {
  const auth = await getCurrentHousehold();

  await clearSession();
  await writeAuditLog({
    userId: auth?.user.id ?? null,
    householdId: auth?.householdId ?? null,
    action: "auth.logout",
  });

  return NextResponse.json({
    data: {
      success: true,
    },
  });
}
