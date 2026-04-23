import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { listExpensesForUser, normalizeExpenseHistoryFilters } from "@/lib/expenses";
import {
  createFallbackOcrResult,
  extractInvoiceData,
  isOcrProviderError,
} from "@/lib/ocr/ocr.service";
import { saveUploadedFile } from "@/lib/storage";
import { validateExpenseUploadFile } from "@/lib/uploads";
import { expenseInputSchema, finalExpenseSchema } from "@/lib/validation/expense";

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
  const filters = normalizeExpenseHistoryFilters({
    invoiceNumber: searchParams.get("invoiceNumber") ?? undefined,
    categoryId: searchParams.get("categoryId") ?? undefined,
    fromDate: searchParams.get("fromDate") ?? undefined,
    toDate: searchParams.get("toDate") ?? undefined,
  });
  const expenses = await listExpensesForUser(user, filters);

  return NextResponse.json({
    data: expenses,
  });
}

export async function POST(request: Request) {
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

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      {
        error: {
          message: "Please upload an invoice file.",
        },
      },
      { status: 400 },
    );
  }

  const uploadError = validateExpenseUploadFile(file);

  if (uploadError) {
    return NextResponse.json(
      {
        error: {
          message: uploadError,
        },
      },
      { status: 400 },
    );
  }

  const input = expenseInputSchema.safeParse({
    categoryId: String(formData.get("categoryId") ?? ""),
    invoiceNumber: String(formData.get("invoiceNumber") ?? ""),
    invoiceDate: String(formData.get("invoiceDate") ?? ""),
    amount: String(formData.get("amount") ?? ""),
  });

  if (!input.success) {
    return NextResponse.json(
      {
        error: {
          message: input.error.issues[0]?.message ?? "Invalid expense payload.",
        },
      },
      { status: 400 },
    );
  }

  const category = await prisma.category.findFirst({
    where: {
      id: input.data.categoryId,
      status: "ACTIVE",
    },
  });

  if (!category) {
    return NextResponse.json(
      {
        error: {
          message: "Select an active category before uploading.",
        },
      },
      { status: 400 },
    );
  }

  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const storedFile = await saveUploadedFile(file, fileBytes);
  const needsOcr =
    !input.data.invoiceNumber ||
    !input.data.invoiceDate ||
    input.data.amount === undefined;
  let ocrData = createFallbackOcrResult();
  let ocrErrorMessage: string | null = null;

  if (needsOcr) {
    try {
      ocrData = await extractInvoiceData({
        fileName: file.name,
        mimeType: file.type,
        absolutePath: storedFile.absolutePath,
        fileBytes,
      });
    } catch (error) {
      if (isOcrProviderError(error)) {
        ocrErrorMessage = error.message;
      } else {
        console.error(error);
        ocrErrorMessage =
          "Could not read this invoice automatically. Enter the invoice number, date, and amount manually.";
      }
    }
  }

  const finalized = finalExpenseSchema.safeParse({
    categoryId: input.data.categoryId,
    invoiceNumber:
      input.data.invoiceNumber ??
      (ocrData.confidence.invoiceNumber > 0 ? ocrData.invoiceNumber : undefined),
    invoiceDate:
      input.data.invoiceDate ??
      (ocrData.confidence.invoiceDate > 0 ? ocrData.invoiceDate : undefined),
    amount:
      input.data.amount ??
      (ocrData.confidence.amount > 0 ? ocrData.amount : undefined),
  });

  if (!finalized.success) {
    if (ocrErrorMessage) {
      return NextResponse.json(
        {
          error: {
            message: ocrErrorMessage,
          },
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: {
          message: finalized.error.issues[0]?.message ?? "Expense could not be saved.",
        },
      },
      { status: 400 },
    );
  }

  const expense = await prisma.expense.create({
    data: {
      userId: user.id,
      categoryId: finalized.data.categoryId,
      invoiceNumber: finalized.data.invoiceNumber,
      invoiceDate: new Date(`${finalized.data.invoiceDate}T00:00:00.000Z`),
      amount: finalized.data.amount,
      filePath: storedFile.relativePath,
    },
    include: {
      category: true,
      user: true,
    },
  });

  return NextResponse.json(
    {
      data: {
        expense,
        ocr: ocrData,
      },
    },
    { status: 201 },
  );
}
