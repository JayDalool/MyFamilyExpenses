import crypto from "node:crypto";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const MIME_TO_EXTENSION: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export function getUploadRoot() {
  const configuredRoot = process.env.UPLOAD_DIR;

  if (configuredRoot && path.isAbsolute(configuredRoot)) {
    return configuredRoot;
  }

  return path.join(/* turbopackIgnore: true */ process.cwd(), "uploads");
}

export async function saveUploadedFile(file: File) {
  const uploadRoot = getUploadRoot();
  const extension = MIME_TO_EXTENSION[file.type] ?? path.extname(file.name) ?? "";
  const fileName = `${crypto.randomUUID()}${extension}`;
  const absolutePath = path.join(uploadRoot, fileName);

  await mkdir(uploadRoot, { recursive: true });
  await writeFile(absolutePath, Buffer.from(await file.arrayBuffer()));

  return {
    fileName,
    absolutePath,
    relativePath: path.posix.join("uploads", fileName),
  };
}
