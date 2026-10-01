import { NextResponse } from "next/server";
import { getCurrentHousehold } from "@/lib/auth/session";
import { getDashboardSummary, getReportData, parseReportFilters } from "@/lib/reporting";

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
  const customFilters = fromDate || toDate
    ? parseReportFilters({
        period: "custom",
        fromDate: fromDate ?? undefined,
        toDate: toDate ?? undefined,
        pageSize: "1",
      })
    : null;
  if (customFilters && !customFilters.ok) {
    return NextResponse.json({ error: customFilters.error }, { status: 400 });
  }

  const [dashboard, customRange] = await Promise.all([
    getDashboardSummary(auth.householdId),
    customFilters?.ok
      ? getReportData(auth.householdId, customFilters.filters)
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
