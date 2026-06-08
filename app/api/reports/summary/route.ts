import { NextResponse } from "next/server";
import { getCurrentHousehold } from "@/lib/auth/session";
import { getDashboardSummary, getReportData, normalizeReportFilters } from "@/lib/reporting";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await getCurrentHousehold();

  if (!auth) {
    return NextResponse.json(
      { error: { message: "Authentication required." } },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const fromDate = searchParams.get("fromDate");
  const toDate = searchParams.get("toDate");
  const [dashboard, customRange] = await Promise.all([
    getDashboardSummary(auth.householdId),
    fromDate && toDate
      ? getReportData(
          auth.householdId,
          normalizeReportFilters({ period: "custom", fromDate, toDate, pageSize: "1" }),
        )
      : Promise.resolve(null),
  ]);

  return NextResponse.json({
    data: {
      today: {
        total: Number(dashboard.today._sum.amount ?? 0),
        count: dashboard.today._count._all,
      },
      month: {
        total: Number(dashboard.month._sum.amount ?? 0),
        count: dashboard.month._count._all,
      },
      allTime: {
        total: Number(dashboard.allTime._sum.amount ?? 0),
        count: dashboard.allTime._count._all,
      },
      range: customRange
        ? {
            total: Number(customRange.summary.total ?? 0),
            count: customRange.summary.count,
            fromDate: customRange.range.from.toISOString().slice(0, 10),
            toDate: customRange.range.to.toISOString().slice(0, 10),
          }
        : null,
    },
  });
}
