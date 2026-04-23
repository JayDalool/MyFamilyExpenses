import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { extractInvoiceData } from "@/lib/ocr/ocr.service";

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { message: "Authentication required." } }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: { message: "Please upload a file." } }, { status: 400 });
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: { message: "Only PDF, PNG, JPG, and WEBP files are allowed." } },
      { status: 400 },
    );
  }

  const ocrData = await extractInvoiceData({ fileName: file.name });
  return NextResponse.json({ data: ocrData });
}
