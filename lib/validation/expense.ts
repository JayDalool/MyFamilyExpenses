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

const optionalPositiveIntegerField = (max: number) =>
  z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().min(1).max(max).optional(),
  );

const optionalPaidByUserId = z.preprocess(
  emptyStringToUndefined,
  z.string().uuid("Select a valid household member").optional(),
);

export const expenseInputSchema = z.object({
  categoryId: z.string().uuid("Select a category"),
  invoiceNumber: optionalTextField,
  invoiceDate: optionalDateField,
  amount: optionalAmountField,
  paidByUserId: optionalPaidByUserId,
});

export const finalExpenseSchema = z.object({
  categoryId: z.string().uuid("Select a category"),
  invoiceNumber: z.string().trim().min(1, "Invoice number is required").max(120),
  invoiceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invoice date must be in YYYY-MM-DD format"),
  amount: z.number().finite().nonnegative("Amount must be zero or greater"),
  paidByUserId: optionalPaidByUserId,
});

export const extractExpenseSchema = z.object({
  categoryId: z.string().uuid("Select a category before scanning or uploading"),
});

// Map a Zod validation failure for an expense payload to a friendly, field-aware
// message. Raw Zod text (e.g. "Invalid input: expected string, received
// undefined") must NEVER reach the user — always route failures through here.
const FRIENDLY_EXPENSE_FIELD_MESSAGES: Record<string, string> = {
  categoryId: "Please select a category.",
  invoiceNumber: "Please add an invoice or reference number.",
  invoiceDate:
    "Please enter the receipt date (YYYY-MM-DD) — we couldn't read it automatically.",
  amount: "Please enter the amount — we couldn't read it confidently.",
  paidByUserId: "Please select a valid household member.",
};

export function friendlyExpenseError(error: z.ZodError): string {
  const issue = error.issues[0];
  const field = typeof issue?.path[0] === "string" ? (issue.path[0] as string) : "";
  return (
    FRIENDLY_EXPENSE_FIELD_MESSAGES[field] ??
    "Some details are missing or invalid. Please review the fields and try again."
  );
}

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
    page: optionalPositiveIntegerField(9999),
    pageSize: optionalPositiveIntegerField(50),
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
