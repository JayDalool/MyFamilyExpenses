import { z } from "zod";

const emptyStringToUndefined = (value: unknown) => {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
};

const optionalTextField = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().min(1).max(120).optional(),
);

const optionalDateField = z.preprocess(
  emptyStringToUndefined,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invoice date must be in YYYY-MM-DD format")
    .optional(),
);

const optionalAmountField = z.preprocess((value) => {
  const normalized = emptyStringToUndefined(value);

  if (normalized === undefined) {
    return undefined;
  }

  if (typeof normalized === "string") {
    return Number(normalized);
  }

  return normalized;
}, z.number().finite().nonnegative("Amount must be zero or greater").optional());

export const expenseInputSchema = z.object({
  categoryId: z.string().uuid("Select a category"),
  invoiceNumber: optionalTextField,
  invoiceDate: optionalDateField,
  amount: optionalAmountField,
});

export const finalExpenseSchema = z.object({
  categoryId: z.string().uuid("Select a category"),
  invoiceNumber: z.string().trim().min(1, "Invoice number is required").max(120),
  invoiceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invoice date must be in YYYY-MM-DD format"),
  amount: z.number().finite().nonnegative("Amount must be zero or greater"),
});
