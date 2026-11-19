import { downloadReport } from "@/lib/reporting/report-download";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return downloadReport(request);
}
