import { NextResponse } from "next/server";
import { getCurrentHousehold } from "@/lib/auth/session";
import { handleCategorySuggestionRequest } from "@/lib/category-suggestion";

// POST (not GET) so the vendor name stays out of URLs and request logs.
// Logic lives in lib/category-suggestion.ts so it can be tested without cookies().
export async function POST(request: Request) {
  const auth = await getCurrentHousehold();
  const body = await request.json().catch(() => null);
  const result = await handleCategorySuggestionRequest(auth, body);
  return NextResponse.json(result.body, { status: result.status });
}
