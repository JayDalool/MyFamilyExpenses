import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { extractInvoiceData } from "@/lib/ocr/ocr.service";
import { validateExpenseUploadFile } from "@/lib/uploads";
import { extractExpenseSchema } from "@/lib/validation/expense";

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

  if (!(file instanceof File)) {
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

  const category = await prisma.category.findFirst({
    where: {
      id: parsed.data.categoryId,
      status: "ACTIVE",
    },
  });

  if (!category) {
    return NextResponse.json(
      {
        error: {
          message: "Select an active category before scanning or uploading.",
        },
      },
      { status: 400 },
    );
  }

  const extraction = await extractInvoiceData({
    fileName: file.name,
    mimeType: file.type,
    fileBytes: new Uint8Array(await file.arrayBuffer()),
  });

  return NextResponse.json({
    data: {
      extraction,
    },
  });
}
