import { NextResponse } from "next/server";
import { getCurrentHousehold } from "@/lib/auth/session";
import { getExpenseForUser } from "@/lib/expenses";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  const auth = await getCurrentHousehold();

  if (!auth) {
    return NextResponse.json(
      { error: { message: "Authentication required." } },
      { status: 401 },
    );
  }

  const { id } = await context.params;
  const expense = await getExpenseForUser(auth, id);

  if (!expense) {
    return NextResponse.json(
      { error: { message: "Expense not found." } },
      { status: 404 },
    );
  }

  return NextResponse.json({ data: expense });
}
