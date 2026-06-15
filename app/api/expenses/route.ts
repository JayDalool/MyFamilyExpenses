import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentHousehold } from "@/lib/auth/session";
import {
  listExpensesPageForUser,
  normalizeExpenseHistoryFilters,
  resolvePaidByUserId,
} from "@/lib/expenses";
import {
  createFallbackOcrResult,
  extractInvoiceData,
  isOcrProviderError,
} from "@/lib/ocr/ocr.service";
import { saveUploadedFile, deleteUploadedFile } from "@/lib/storage";
import { detectExpenseUploadMimeType, validateExpenseUploadFile } from "@/lib/uploads";
import {
  expenseInputSchema,
  finalExpenseSchema,
  friendlyExpenseError,
} from "@/lib/validation/expense";
import { generateReceiptLabel } from "@/lib/ocr/receipt-label";
import {
  computeFileSha256,
  consumeExtractionAttempt,
} from "@/lib/ocr/extraction-attempt";
import { recordCorrectionFeedback } from "@/lib/ocr/correction-feedback";
import { writeAuditLog } from "@/lib/audit";
import { revalidateExpenseViews } from "@/lib/revalidation";
import { canCreateExpense } from "@/lib/auth/permissions";

export async function GET(request: Request) {
  const auth = await getCurrentHousehold();

  if (!auth) {
    return NextResponse.json(
      { error: { message: "Authentication required." } },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const filters = normalizeExpenseHistoryFilters({
    invoiceNumber: searchParams.get("invoiceNumber") ?? undefined,
    categoryId: searchParams.get("categoryId") ?? undefined,
    fromDate: searchParams.get("fromDate") ?? undefined,
    toDate: searchParams.get("toDate") ?? undefined,
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
  });
  const expensePage = await listExpensesPageForUser(auth, filters);

  return NextResponse.json({
    data: expensePage.expenses,
    meta: { pagination: expensePage.pagination },
  });
}

export async function POST(request: Request) {
  const auth = await getCurrentHousehold();

  if (!auth) {
    return NextResponse.json(
      { error: { message: "Authentication required." } },
      { status: 401 },
    );
  }

  if (!canCreateExpense(auth)) {
    return NextResponse.json(
      { error: { message: "Your household role can only view expenses." } },
      { status: 403 },
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { error: { message: "Please upload an invoice file." } },
      { status: 400 },
    );
  }

  const uploadError = validateExpenseUploadFile(file);

  if (uploadError) {
    return NextResponse.json({ error: { message: uploadError } }, { status: 400 });
  }

  const input = expenseInputSchema.safeParse({
    categoryId: String(formData.get("categoryId") ?? ""),
    invoiceNumber: String(formData.get("invoiceNumber") ?? ""),
    invoiceDate: String(formData.get("invoiceDate") ?? ""),
    amount: String(formData.get("amount") ?? ""),
    paidByUserId: String(formData.get("paidByUserId") ?? ""),
  });

  if (!input.success) {
    return NextResponse.json(
      { error: { message: friendlyExpenseError(input.error) } },
      { status: 400 },
    );
  }

  // Resolve and authorize who the spending is attributed to (defaults to self).
  const paidByUserId = await resolvePaidByUserId(auth, input.data.paidByUserId);

  if (!paidByUserId) {
    return NextResponse.json(
      { error: { message: "You can only assign expenses to active household members." } },
      { status: 400 },
    );
  }

  // Verify the category belongs to this household
  const category = await prisma.category.findFirst({
    where: {
      id: input.data.categoryId,
      householdId: auth.householdId,
      status: "ACTIVE",
    },
  });

  if (!category) {
    return NextResponse.json(
      { error: { message: "Select an active category before uploading." } },
      { status: 400 },
    );
  }

  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const contentError = validateExpenseUploadFile(file, fileBytes);

  if (contentError) {
    return NextResponse.json({ error: { message: contentError } }, { status: 400 });
  }

  const detectedMimeType = detectExpenseUploadMimeType(fileBytes);
  const storedFile = await saveUploadedFile(file, fileBytes, detectedMimeType);

  try {
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
          mimeType: detectedMimeType ?? file.type,
          absolutePath: storedFile.absolutePath,
          fileBytes,
        });
      } catch (error) {
        if (isOcrProviderError(error)) {
          ocrErrorMessage = error.message;
        } else {
          console.error(error);
          await writeAuditLog({
            userId: auth.user.id,
            householdId: auth.householdId,
            action: "expense.upload.ocr_failed",
            metadata: {
              categoryId: input.data.categoryId,
              fileSize: file.size,
              mimeType: detectedMimeType ?? file.type,
              errorCode: "UNEXPECTED_ERROR",
            },
          });
          ocrErrorMessage =
            "Could not read this invoice automatically. Enter the invoice number, date, and amount manually.";
        }
      }
    }

    // Prefer the user's typed value, then a confidently OCR-detected value.
    const resolvedInvoice =
      input.data.invoiceNumber ??
      (ocrData.confidence.invoiceNumber > 0 ? ocrData.invoiceNumber : undefined);
    const resolvedDate =
      input.data.invoiceDate ??
      (ocrData.confidence.invoiceDate > 0 ? ocrData.invoiceDate : undefined);
    const resolvedAmount =
      input.data.amount ??
      (ocrData.confidence.amount > 0 ? ocrData.amount : undefined);

    // No invoice/reference on the receipt (bank/ATM, cash slip)? Generate a safe
    // storage label from merchant + date so the save isn't blocked. This is NOT
    // presented to the user as an OCR-detected invoice number, and we never
    // generate the amount (wrong amount is worse than blank).
    const invoiceForSave =
      resolvedInvoice ?? generateReceiptLabel(ocrData.merchant, resolvedDate);

    const finalized = finalExpenseSchema.safeParse({
      categoryId: input.data.categoryId,
      invoiceNumber: invoiceForSave,
      invoiceDate: resolvedDate,
      amount: resolvedAmount,
    });

    if (!finalized.success) {
      await deleteUploadedFile(storedFile.absolutePath);

      if (ocrErrorMessage) {
        return NextResponse.json({ error: { message: ocrErrorMessage } }, { status: 400 });
      }

      return NextResponse.json(
        { error: { message: friendlyExpenseError(finalized.error) } },
        { status: 400 },
      );
    }

    const expense = await prisma.expense.create({
      data: {
        userId: auth.user.id,
        paidByUserId,
        householdId: auth.householdId,
        categoryId: finalized.data.categoryId,
        invoiceNumber: finalized.data.invoiceNumber,
        invoiceDate: new Date(`${finalized.data.invoiceDate}T00:00:00.000Z`),
        amount: finalized.data.amount,
        filePath: storedFile.relativePath,
      },
      include: {
        category: true,
        user: true,
        paidByUser: { select: { id: true, name: true } },
      },
    });

    // Best-effort, single-use link to the trusted extraction attempt. Done AFTER
    // the expense exists and outside any transaction: a failed/expired/foreign
    // attempt must never undo the saved expense (the user's primary artifact).
    const attemptId = String(formData.get("attemptId") ?? "").trim();
    let attemptLinked = false;
    if (attemptId) {
      attemptLinked = await consumeExtractionAttempt({
        attemptId,
        userId: auth.user.id,
        householdId: auth.householdId,
        fileSha256: computeFileSha256(fileBytes),
        expenseId: expense.id,
      });
    }

    // Phase C: durable predicted-vs-final learning signal. Only written when a
    // trusted attempt was actually consumed/linked (so no attemptId, expired,
    // foreign, or unmatched attempts produce no feedback). Best-effort — a failure
    // here never undoes the saved expense.
    let feedbackRecorded = false;
    if (attemptLinked) {
      feedbackRecorded = await recordCorrectionFeedback({
        attemptId,
        expenseId: expense.id,
        userId: auth.user.id,
        householdId: auth.householdId,
        final: {
          invoiceNumber: finalized.data.invoiceNumber,
          invoiceDate: finalized.data.invoiceDate,
          amount: finalized.data.amount,
          categoryId: expense.categoryId,
          paidByUserId: expense.paidByUserId,
        },
      });
    }

    await writeAuditLog({
      userId: auth.user.id,
      householdId: auth.householdId,
      action: "expense.create",
      metadata: {
        expenseId: expense.id,
        categoryId: expense.categoryId,
        paidByUserId: expense.paidByUserId,
        amount: expense.amount.toString(),
        fileSize: file.size,
        mimeType: detectedMimeType ?? file.type,
        // Deploy signal: whether a trusted extraction attempt was linked.
        attemptProvided: Boolean(attemptId),
        attemptLinked,
        feedbackRecorded,
      },
    });
    await writeAuditLog({
      userId: auth.user.id,
      householdId: auth.householdId,
      action: "expense.upload.saved",
      metadata: {
        expenseId: expense.id,
        filePath: storedFile.relativePath,
        fileSize: file.size,
        mimeType: detectedMimeType ?? file.type,
      },
    });
    revalidateExpenseViews(expense.id);

    return NextResponse.json({ data: { expense, ocr: ocrData } }, { status: 201 });
  } catch (error) {
    await deleteUploadedFile(storedFile.absolutePath);
    await writeAuditLog({
      userId: auth.user.id,
      householdId: auth.householdId,
      action: "expense.upload.save_failed",
      metadata: {
        categoryId: input.data.categoryId,
        fileSize: file.size,
        mimeType: detectedMimeType ?? file.type,
        errorCode: error instanceof Error ? error.name : "UNKNOWN_ERROR",
      },
    });
    throw error;
  }
}
