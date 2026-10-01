import path from "node:path";
import { getUploadRoot } from "@/lib/storage";

export function getStoredExpenseAbsolutePath(storedPath: string) {
  return path.join(getUploadRoot(), path.basename(storedPath));
}

export function getStoredExpenseMimeType(storedPath: string) {
  const extension = path.extname(storedPath).toLowerCase();

  switch (extension) {
    case ".pdf":
      return "application/pdf";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

export function isPreviewableImage(storedPath: string) {
  return getStoredExpenseMimeType(storedPath).startsWith("image/");
}
