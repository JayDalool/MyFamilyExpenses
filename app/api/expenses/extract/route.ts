import { NextResponse } from "next/server";
import { getCurrentHousehold } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { runExtraction, isOcrProviderError } from "@/lib/ocr/ocr.service";
import { hasAnyOcrField } from "@/lib/ocr/ocr-parsing";
import {
  computeFileSha256,
  createExtractionAttempt,
} from "@/lib/ocr/extraction-attempt";
import { isLowQualityImage } from "@/lib/ocr/image-quality";
import { detectExpenseUploadMimeType, validateExpenseUploadFile } from "@/lib/uploads";
import { extractExpenseSchema, friendlyExpenseError } from "@/lib/validation/expense";
import { writeAuditLog } from "@/lib/audit";
import { canCreateExpense } from "@/lib/auth/permissions";

// User-facing OCR guidance. We prefer a friendly fallback (and always allow
// manual entry) over hard-rejecting an upload.
const LOW_QUALITY_MESSAGE =
  "Could not read this receipt clearly. The image may be too small, blurry, or angled. You can upload a clearer photo or fill in the fields manually.";
const UNREADABLE_MESSAGE =
  "Could not read this receipt clearly. You can upload a clearer photo or fill in the fields manually.";
// Softer note used when the image is small but useful fields were still found.
const SMALL_IMAGE_NOTE = "Image is small — please verify the values below.";

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
          message: friendlyExpenseError(parsed.error),
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

  // Known low-resolution images won't OCR well. We don't pre-reject (a small but
  // readable receipt should still succeed) — this only tailors the guidance shown
  // when OCR can't extract anything.
  const lowQuality = isLowQualityImage(fileBytes);

  try {
    const envelope = await runExtraction({
      fileName: file.name,
      mimeType: detectedMimeType ?? file.type,
      fileBytes,
    });
    const extraction = envelope.response;

    // Always return the extraction (Stage A): even with no confident fields it
    // carries ranked candidates, receipt type, multi-receipt detection, and
    // warnings the wizard needs. A low-resolution image adds a friendly,
    // image-based warning on top of any parser warnings. Manual entry always
    // works. Genuine engine failures still throw and are handled below.
    const detected = hasAnyOcrField(extraction);
    // Useful = the critical household fields (date or amount) were found. When
    // they are, a small/low-res image gets only a soft "verify" note instead of
    // the harsh "could not read clearly" warning.
    const hasUsefulFields =
      extraction.confidence.invoiceDate > 0 || extraction.confidence.amount > 0;
    const warnings = lowQuality
      ? hasUsefulFields
        ? [SMALL_IMAGE_NOTE, ...extraction.warnings]
        : [LOW_QUALITY_MESSAGE, ...extraction.warnings]
      : extraction.warnings.length > 0
        ? extraction.warnings
        : detected
          ? []
          : [UNREADABLE_MESSAGE];

    await writeAuditLog({
      userId: auth.user.id,
      householdId: auth.householdId,
      action: detected ? "expense.upload.ocr" : "expense.upload.ocr_failed",
      metadata: {
        categoryId: parsed.data.categoryId,
        fileSize: file.size,
        mimeType: detectedMimeType ?? file.type,
        provider: extraction.provider,
        receiptType: extraction.receiptType,
        multipleReceipts: extraction.multipleReceipts,
        lowQuality,
        ...(detected ? {} : { errorCode: lowQuality ? "LOW_QUALITY_IMAGE" : "OCR_NO_FIELDS" }),
      },
    });

    // Persist a trusted server-side snapshot of what OCR/the parser saw, before
    // the user edits anything. Best-effort: a failure here never blocks the user
    // (the response simply carries no attemptId and save still works).
    const fileSha256 = computeFileSha256(fileBytes);
    const attemptId = await createExtractionAttempt({
      userId: auth.user.id,
      householdId: auth.householdId,
      fileSha256,
      fileBytes,
      envelope,
    });

    return NextResponse.json({
      data: { extraction: { ...extraction, warnings }, attemptId },
    });
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
          lowQuality,
        },
      });

      // PDF is its own clear case. For generic OCR failures on a known
      // low-resolution image, prefer the more specific low-quality guidance.
      if (error.code === "PDF_NOT_SUPPORTED") {
        return NextResponse.json({ error: { message: error.message } }, { status: 422 });
      }

      return NextResponse.json(
        {
          error: {
            code: lowQuality ? "LOW_QUALITY_IMAGE" : undefined,
            message: lowQuality ? LOW_QUALITY_MESSAGE : error.message,
          },
        },
        { status: 400 },
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
          message: lowQuality ? LOW_QUALITY_MESSAGE : UNREADABLE_MESSAGE,
        },
      },
      { status: 500 },
    );
  }
}
