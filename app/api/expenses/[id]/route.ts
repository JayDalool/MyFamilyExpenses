import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getExpenseForUser } from "@/lib/expenses";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
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

  const { id } = await context.params;
  const expense = await getExpenseForUser(user, id);

  if (!expense) {
    return NextResponse.json(
      {
        error: {
          message: "Expense not found.",
        },
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    data: expense,
  });
}
