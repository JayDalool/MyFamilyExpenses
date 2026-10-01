import { revalidatePath } from "next/cache";

export function revalidateExpenseViews(expenseId?: string) {
  revalidatePath("/dashboard");
  revalidatePath("/expenses");
  revalidatePath("/reports");
  if (expenseId) revalidatePath(`/expenses/${expenseId}`);
}

export function revalidateCategoryViews() {
  revalidatePath("/categories");
  revalidatePath("/expenses");
  revalidatePath("/reports");
}
