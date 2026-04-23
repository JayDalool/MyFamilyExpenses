const ALLOWED_EXPENSE_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function getMaxUploadBytes() {
  return Number(process.env.MAX_UPLOAD_MB ?? "10") * 1024 * 1024;
}

export function isAllowedExpenseUploadMimeType(mimeType: string) {
  return ALLOWED_EXPENSE_UPLOAD_MIME_TYPES.has(mimeType);
}

export function validateExpenseUploadFile(file: File) {
  if (file.size === 0) {
    return "Please upload an invoice file.";
  }

  if (!isAllowedExpenseUploadMimeType(file.type)) {
    return "Only PDF, PNG, JPG, and WEBP files are allowed.";
  }

  if (file.size > getMaxUploadBytes()) {
    return "The uploaded file is too large.";
  }

  return null;
}
