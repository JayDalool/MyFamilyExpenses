import { NextResponse } from "next/server";
import { z } from "zod";
import { canCreateExpense } from "@/lib/auth/permissions";
import { getCurrentHousehold } from "@/lib/auth/session";
import { suggestCategoryForVendor } from "@/lib/category-suggestion";

const bodySchema = z.object({ vendor: z.string().trim().min(1).max(120) });

// POST (not GET) so the vendor name stays out of URLs and request logs.
// The vendor is never written to the audit log or the console.
export async function POST(request: Request) {
  const auth = await getCurrentHousehold();

  if (!auth) {
    return NextResponse.json({ error: { message: "Authentication required." } }, { status: 401 });
  }

  if (!canCreateExpense(auth)) {
    return NextResponse.json(
      { error: { message: "Your household role cannot add expenses." } },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: { message: "A vendor name is required." } }, { status: 400 });
  }

  try {
    const suggestion = await suggestCategoryForVendor(auth, parsed.data.vendor);
    return NextResponse.json({ data: { suggestion } });
  } catch (error) {
    console.error("Category suggestion failed:", error instanceof Error ? error.name : "unknown");
    return NextResponse.json(
      { error: { message: "Could not look up a suggestion." } },
      { status: 500 },
    );
  }
}
