import { NextResponse } from "next/server";
import { getCurrentHousehold } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { extractInvoiceData, isOcrProviderError } from "@/lib/ocr/ocr.service";
import { validateExpenseUploadFile } from "@/lib/uploads";
import { extractExpenseSchema } from "@/lib/validation/expense";

export async function POST(request: Request) {
  const auth = await getCurrentHousehold();

  if (!auth) {
    return NextResponse.json(
      { error: { message: "Authentication required." } },
      { status: 401 },
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
      mimeType: file.type,
      fileBytes: new Uint8Array(await file.arrayBuffer()),
    });

    return NextResponse.json({ data: { extraction } });
  } catch (error) {
    if (isOcrProviderError(error)) {
      return NextResponse.json(
        { error: { message: error.message } },
        { status: error.code === "PDF_NOT_SUPPORTED" ? 422 : 400 },
      );
    }

    console.error(error);

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
