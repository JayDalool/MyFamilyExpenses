import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { extractInvoiceData } from "@/lib/ocr/ocr.service";
import { saveUploadedFile } from "@/lib/storage";
import { expenseInputSchema, finalExpenseSchema } from "@/lib/validation/expense";

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function parseMaxUploadBytes() {
  return Number(process.env.MAX_UPLOAD_MB ?? "10") * 1024 * 1024;
}

export async function GET() {
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

  const expenses = await prisma.expense.findMany({
    where: user.role === "ADMIN" ? {} : { userId: user.id },
    include: {
      category: true,
      user: true,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 50,
  });

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

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      {
        error: {
          message: "Only PDF, PNG, JPG, and WEBP files are allowed.",
        },
      },
      { status: 400 },
    );
  }

  if (file.size > parseMaxUploadBytes()) {
    return NextResponse.json(
      {
        error: {
          message: "The uploaded file is too large.",
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

  const storedFile = await saveUploadedFile(file);
  const ocrData = await extractInvoiceData({ fileName: file.name });

  const finalized = finalExpenseSchema.safeParse({
    categoryId: input.data.categoryId,
    invoiceNumber: input.data.invoiceNumber ?? ocrData.invoiceNumber,
    invoiceDate: input.data.invoiceDate ?? ocrData.invoiceDate,
    amount: input.data.amount ?? ocrData.amount,
  });

  if (!finalized.success) {
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
