import { NextResponse } from "next/server";
import { getCurrentHousehold } from "@/lib/auth/session";
import { getHouseholdLearningInsights } from "@/lib/ocr/learning-insights";
import { buildTemplateRecommendations } from "@/lib/ocr/templates";

export const dynamic = "force-dynamic";

// Household-scoped OCR learning analytics. Returns only derived feedback metrics
// (no raw OCR text, no blocks, no invoice/reference strings — see the insights
// allowlist). Scoping is enforced inside getHouseholdLearningInsights.
export async function GET() {
  const auth = await getCurrentHousehold();

  if (!auth) {
    return NextResponse.json(
      { error: { message: "Authentication required." } },
      { status: 401 },
    );
  }

  try {
    const insights = await getHouseholdLearningInsights(auth.householdId);
    const recommendations = buildTemplateRecommendations(insights);
    return NextResponse.json({ data: { insights, recommendations } });
  } catch (error) {
    // Never surface a raw Prisma/internal error to the client.
    console.error("ocr-learning summary failed", error instanceof Error ? error.name : "UNKNOWN");
    return NextResponse.json(
      { error: { message: "Could not load OCR learning data right now." } },
      { status: 500 },
    );
  }
}
