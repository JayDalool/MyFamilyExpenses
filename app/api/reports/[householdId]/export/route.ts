import { downloadReport } from "@/lib/reporting/report-download";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ householdId: string }> }) {
  const { householdId } = await params;
  return downloadReport(request, householdId);
}
