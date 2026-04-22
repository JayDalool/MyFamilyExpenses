import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { getStartOfMonth, getStartOfToday } from "@/lib/utils";

export async function GET(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      {
        error: {
          message: "Authentication required.",
        },
      },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const fromDate = searchParams.get("fromDate");
  const toDate = searchParams.get("toDate");
  const scope = user.role === "ADMIN" ? {} : { userId: user.id };

  const [today, month, customRange] = await Promise.all([
    prisma.expense.aggregate({
      where: {
        ...scope,
        invoiceDate: {
          gte: getStartOfToday(),
        },
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.expense.aggregate({
      where: {
        ...scope,
        invoiceDate: {
          gte: getStartOfMonth(),
        },
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    fromDate && toDate
      ? prisma.expense.aggregate({
          where: {
            ...scope,
            invoiceDate: {
              gte: new Date(`${fromDate}T00:00:00.000Z`),
              lte: new Date(`${toDate}T23:59:59.999Z`),
            },
          },
          _sum: { amount: true },
          _count: { _all: true },
        })
      : Promise.resolve(null),
  ]);

  return NextResponse.json({
    data: {
      today: {
        total: Number(today._sum.amount ?? 0),
        count: today._count._all,
      },
      month: {
        total: Number(month._sum.amount ?? 0),
        count: month._count._all,
      },
      range: customRange
        ? {
            total: Number(customRange._sum.amount ?? 0),
            count: customRange._count._all,
            fromDate,
            toDate,
          }
        : null,
    },
  });
}
