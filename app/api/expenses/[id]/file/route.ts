import path from "node:path";
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import {
  getStoredExpenseAbsolutePath,
  getStoredExpenseMimeType,
} from "@/lib/expense-files";
import { getExpenseForUser } from "@/lib/expenses";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
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

  try {
    const file = await readFile(getStoredExpenseAbsolutePath(expense.filePath));
    const { searchParams } = new URL(request.url);
    const download = searchParams.get("download") === "1";
    const fileName = path.basename(expense.filePath);

    return new NextResponse(file, {
      headers: {
        "Content-Type": getStoredExpenseMimeType(expense.filePath),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json(
      {
        error: {
          message: "Invoice file not found.",
        },
      },
      { status: 404 },
    );
  }
}
