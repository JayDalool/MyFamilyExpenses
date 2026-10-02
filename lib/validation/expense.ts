import { z } from "zod";

const PAYMENT_METHODS = ["CASH", "DEBIT", "CREDIT", "ETRANSFER", "OTHER"] as const;

// The Int column tops out here; reject rather than let Postgres raise.
const MAX_AMOUNT = 21_474_836.47;

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
}, z
  .number()
  .finite()
  .nonnegative("Amount must be zero or greater")
  .max(MAX_AMOUNT, "Amount is too large")
  .optional());

const optionalPositiveIntegerField = (max: number) =>
  z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().min(1).max(max).optional(),
  );

const optionalVendorField = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().min(1).max(120).optional(),
);

const optionalNotesField = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().min(1).max(500).optional(),
);

const optionalPaymentMethodField = z.preprocess(
  emptyStringToUndefined,
  z.enum(PAYMENT_METHODS).optional(),
);

// ISO 4217. Single-currency today; conversion is deferred, so this only guards
// the shape.
const optionalCurrencyField = z.preprocess(
  emptyStringToUndefined,
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code")
    .optional(),
);

const optionalTaxField = z.preprocess((value) => {
  const normalized = emptyStringToUndefined(value);

  if (normalized === undefined) {
    return undefined;
  }

  if (typeof normalized === "string") {
    return Number(normalized);
  }

  return normalized;
}, z.number().finite().nonnegative("Tax must be zero or greater").max(MAX_AMOUNT).optional());

const optionalBusinessField = z.preprocess((value) => {
  if (value === "on" || value === "true" || value === true) return true;
  if (value === undefined || value === null || value === "" || value === "false" || value === false) {
    return false;
  }
  return value;
}, z.boolean());

const optionalPaidByUserId = z.preprocess(
  emptyStringToUndefined,
  z.string().uuid("Select a valid household member").optional(),
);

const stepFourFields = {
  tax: optionalTaxField,
  currency: optionalCurrencyField,
  vendor: optionalVendorField,
  paymentMethod: optionalPaymentMethodField,
  notes: optionalNotesField,
  isBusiness: optionalBusinessField,
} as const;

export const expenseInputSchema = z.object({
  categoryId: z.string().uuid("Select a category"),
  invoiceNumber: optionalTextField,
  invoiceDate: optionalDateField,
  amount: optionalAmountField,
  paidByUserId: optionalPaidByUserId,
  ...stepFourFields,
});

export const finalExpenseSchema = z
  .object({
    categoryId: z.string().uuid("Select a category"),
    invoiceNumber: z.string().trim().min(1, "Invoice number is required").max(120),
    invoiceDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Invoice date must be in YYYY-MM-DD format"),
    amount: z
      .number()
      .finite()
      .nonnegative("Amount must be zero or greater")
      .max(MAX_AMOUNT, "Amount is too large"),
    paidByUserId: optionalPaidByUserId,
    ...stepFourFields,
  })
  // The amount is the total WITH tax, so tax can never exceed it. The database
  // carries the same rule as a CHECK constraint.
  .refine((value) => value.tax === undefined || value.tax <= value.amount, {
    message: "Tax cannot be more than the total amount",
    path: ["tax"],
  });

// The create route receives a multipart form, so every value arrives as a
// string (or is absent). This is the ONLY place that maps the form to the input
// schema: the route and its test both call it, so a new field cannot be added to
// one and forgotten in the other. That omission is exactly what shipped vendor,
// tax, payment method, notes and the business flag as nulls.
export function parseExpenseForm(formData: Pick<FormData, "get">) {
  const text = (key: string) => String(formData.get(key) ?? "");

  return expenseInputSchema.safeParse({
    categoryId: text("categoryId"),
    invoiceNumber: text("invoiceNumber"),
    invoiceDate: text("invoiceDate"),
    amount: text("amount"),
    paidByUserId: text("paidByUserId"),
    tax: text("tax"),
    currency: text("currency"),
    vendor: text("vendor"),
    paymentMethod: text("paymentMethod"),
    notes: text("notes"),
    // Raw, not text(): an unticked checkbox is absent from the form, and
    // optionalBusinessField resolves null to false. String(null) is "null".
    isBusiness: formData.get("isBusiness"),
  });
}

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
  tax: "Please check the tax — it cannot be more than the total.",
  currency: "Please use a 3-letter currency code, such as CAD.",
  vendor: "Please shorten the vendor name (120 characters or fewer).",
  paymentMethod: "Please choose one of the listed payment methods.",
  notes: "Please shorten the note (500 characters or fewer).",
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
