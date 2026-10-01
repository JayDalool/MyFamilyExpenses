const ALLOWED_EXPENSE_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function getMaxUploadBytes() {
  return Number(process.env.MAX_UPLOAD_MB ?? "10") * 1024 * 1024;
}

export function isAllowedExpenseUploadMimeType(mimeType: string) {
  return ALLOWED_EXPENSE_UPLOAD_MIME_TYPES.has(mimeType);
}

function hasSignature(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

export function detectExpenseUploadMimeType(bytes: Uint8Array) {
  if (bytes.length >= PDF_SIGNATURE.length && hasSignature(bytes, PDF_SIGNATURE)) {
    return "application/pdf";
  }

  if (bytes.length >= PNG_SIGNATURE.length && hasSignature(bytes, PNG_SIGNATURE)) {
    return "image/png";
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

export function validateExpenseUploadFile(file: File, fileBytes?: Uint8Array) {
  if (file.size === 0) {
    return "Please upload an invoice file.";
  }

  if (file.type && !isAllowedExpenseUploadMimeType(file.type)) {
    return "Only PDF, PNG, JPG, and WEBP files are allowed.";
  }

  if (file.size > getMaxUploadBytes()) {
    return "The uploaded file is too large.";
  }

  if (fileBytes) {
    const detectedMimeType = detectExpenseUploadMimeType(fileBytes);

    if (!detectedMimeType) {
      return "The uploaded file is not a valid PDF, PNG, JPG, or WEBP file.";
    }

    if (file.type && detectedMimeType !== file.type) {
      return "The uploaded file contents do not match the selected file type.";
    }
  }

  return null;
}
