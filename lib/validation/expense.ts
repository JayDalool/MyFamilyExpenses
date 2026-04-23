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

export const extractExpenseSchema = z.object({
  categoryId: z.string().uuid("Select a category before scanning or uploading"),
});

export const expenseHistoryFiltersSchema = z
  .object({
    invoiceNumber: z.preprocess(
      emptyStringToUndefined,
      z.string().trim().max(120).optional(),
    ),
    categoryId: z.preprocess(
      emptyStringToUndefined,
      z.string().uuid("Category must be valid").optional(),
    ),
    fromDate: z.preprocess(
      emptyStringToUndefined,
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "From date must be in YYYY-MM-DD format")
        .optional(),
    ),
    toDate: z.preprocess(
      emptyStringToUndefined,
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "To date must be in YYYY-MM-DD format")
        .optional(),
    ),
  })
  .refine(
    (value) =>
      !value.fromDate || !value.toDate || value.fromDate <= value.toDate,
    {
      message: "From date must be earlier than or equal to To date",
      path: ["toDate"],
    },
  );

export type ExpenseHistoryFilters = z.output<typeof expenseHistoryFiltersSchema>;
