import { NextResponse } from "next/server";
import { getCurrentHousehold } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { extractInvoiceData, isOcrProviderError } from "@/lib/ocr/ocr.service";
import { detectExpenseUploadMimeType, validateExpenseUploadFile } from "@/lib/uploads";
import { extractExpenseSchema } from "@/lib/validation/expense";
import { writeAuditLog } from "@/lib/audit";
import { canCreateExpense } from "@/lib/auth/permissions";

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
      { error: { message: "Your household role cannot upload receipts." } },
      { status: 403 },
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: { message: "Please upload an invoice file." } },
      { status: 400 },
    );
  }

  const uploadError = validateExpenseUploadFile(file);

  if (uploadError) {
    return NextResponse.json({ error: { message: uploadError } }, { status: 400 });
  }

  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const contentError = validateExpenseUploadFile(file, fileBytes);

  if (contentError) {
    return NextResponse.json({ error: { message: contentError } }, { status: 400 });
  }

  const detectedMimeType = detectExpenseUploadMimeType(fileBytes);

  const parsed = extractExpenseSchema.safeParse({
    categoryId: String(formData.get("categoryId") ?? ""),
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          message:
            parsed.error.issues[0]?.message ??
            "Select a category before scanning or uploading.",
        },
      },
      { status: 400 },
    );
  }

  // Verify the category belongs to this household
  const category = await prisma.category.findFirst({
    where: {
      id: parsed.data.categoryId,
      householdId: auth.householdId,
      status: "ACTIVE",
    },
  });

  if (!category) {
    return NextResponse.json(
      { error: { message: "Select an active category before scanning or uploading." } },
      { status: 400 },
    );
  }

  try {
    const extraction = await extractInvoiceData({
      fileName: file.name,
      mimeType: detectedMimeType ?? file.type,
      fileBytes,
    });

    await writeAuditLog({
      userId: auth.user.id,
      householdId: auth.householdId,
      action: "expense.upload.ocr",
      metadata: {
        categoryId: parsed.data.categoryId,
        fileSize: file.size,
        mimeType: detectedMimeType ?? file.type,
        provider: extraction.provider,
      },
    });

    return NextResponse.json({ data: { extraction } });
  } catch (error) {
    if (isOcrProviderError(error)) {
      await writeAuditLog({
        userId: auth.user.id,
        householdId: auth.householdId,
        action: "expense.upload.ocr_failed",
        metadata: {
          categoryId: parsed.data.categoryId,
          fileSize: file.size,
          mimeType: detectedMimeType ?? file.type,
          errorCode: error.code,
        },
      });

      return NextResponse.json(
        { error: { message: error.message } },
        { status: error.code === "PDF_NOT_SUPPORTED" ? 422 : 400 },
      );
    }

    console.error(error);
    await writeAuditLog({
      userId: auth.user.id,
      householdId: auth.householdId,
      action: "expense.upload.ocr_failed",
      metadata: {
        categoryId: parsed.data.categoryId,
        fileSize: file.size,
        mimeType: detectedMimeType ?? file.type,
        errorCode: "UNEXPECTED_ERROR",
      },
    });

    return NextResponse.json(
      {
        error: {
          message:
            "Could not read this invoice automatically. You can continue and fill in the fields manually.",
        },
      },
      { status: 500 },
    );
  }
}
