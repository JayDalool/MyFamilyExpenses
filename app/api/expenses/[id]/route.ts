import { NextResponse } from "next/server";
import { getCurrentHousehold } from "@/lib/auth/session";
import {
  findAllowedExpenseCategoryForUpdate,
  getExpenseForUser,
  softDeleteExpenseForUser,
  updateExpenseForUser,
} from "@/lib/expenses";
import { finalExpenseSchema } from "@/lib/validation/expense";
import { writeAuditLog } from "@/lib/audit";
import { revalidateExpenseViews } from "@/lib/revalidation";

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

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await getCurrentHousehold();

  if (!auth) {
    return NextResponse.json(
      { error: { message: "Authentication required." } },
      { status: 401 },
    );
  }

  const { id } = await context.params;
  const payload = await request.json().catch(() => null);
  const parsed = finalExpenseSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: { message: parsed.error.issues[0]?.message ?? "Invalid expense data." } },
      { status: 400 },
    );
  }

  const existingExpense = await getExpenseForUser(auth, id);

  if (!existingExpense) {
    return NextResponse.json(
      { error: { message: "Expense not found." } },
      { status: 404 },
    );
  }

  const category = await findAllowedExpenseCategoryForUpdate(
    auth,
    parsed.data.categoryId,
    existingExpense.categoryId,
  );

  if (!category) {
    return NextResponse.json(
      { error: { message: "Select an active category." } },
      { status: 400 },
    );
    }

  const expense = await updateExpenseForUser(auth, id, {
      categoryId: parsed.data.categoryId,
      invoiceNumber: parsed.data.invoiceNumber,
      invoiceDate: new Date(`${parsed.data.invoiceDate}T00:00:00.000Z`),
      amount: parsed.data.amount,
  });

  if (!expense) {
    return NextResponse.json(
      { error: { message: "Expense not found." } },
      { status: 404 },
    );
  }

  await writeAuditLog({
    userId: auth.user.id,
    householdId: auth.householdId,
    action: "expense.update",
    metadata: {
      expenseId: id,
      previous: {
        categoryId: existingExpense.categoryId,
        invoiceNumber: existingExpense.invoiceNumber,
        invoiceDate: existingExpense.invoiceDate.toISOString().slice(0, 10),
        amount: existingExpense.amount.toString(),
      },
      next: {
        categoryId: expense.categoryId,
        invoiceNumber: expense.invoiceNumber,
        invoiceDate: expense.invoiceDate.toISOString().slice(0, 10),
        amount: expense.amount.toString(),
      },
    },
  });
  revalidateExpenseViews(id);

  return NextResponse.json({ data: expense });
}

export async function DELETE(_: Request, context: RouteContext) {
  const auth = await getCurrentHousehold();

  if (!auth) {
    return NextResponse.json(
      { error: { message: "Authentication required." } },
      { status: 401 },
    );
  }

  const { id } = await context.params;
  const existingExpense = await getExpenseForUser(auth, id);

  if (!existingExpense) {
    return NextResponse.json(
      { error: { message: "Expense not found." } },
      { status: 404 },
    );
  }

  const expense = await softDeleteExpenseForUser(auth, id, auth.user.id);

  if (!expense) {
    return NextResponse.json(
      { error: { message: "Expense not found." } },
      { status: 404 },
    );
  }

  await writeAuditLog({
    userId: auth.user.id,
    householdId: auth.householdId,
    action: "expense.delete",
    metadata: {
      expenseId: id,
      mode: "soft_delete",
      invoiceNumber: existingExpense.invoiceNumber,
    },
  });
  revalidateExpenseViews(id);

  return NextResponse.json({ data: { expense, success: true } });
}
