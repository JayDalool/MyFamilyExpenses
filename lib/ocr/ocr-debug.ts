import crypto from "node:crypto";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { OcrInput, OcrResult } from "@/lib/ocr/types";

function isTruthy(value: string | undefined) {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function resolveLocalDirectory(configuredPath: string | undefined, fallbackPath: string) {
  if (!configuredPath) {
    return fallbackPath;
  }

  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(process.cwd(), configuredPath);
}

function shouldWriteOcrDebugArtifacts() {
  return process.env.NODE_ENV === "development" && isTruthy(process.env.OCR_DEBUG);
}

function sanitizeFileName(fileName: string) {
  const sanitized = fileName
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized.slice(0, 40) || "receipt";
}

export async function writeOcrDebugArtifact({
  input,
  rawText,
  result,
  overallConfidence,
}: {
  input: OcrInput;
  rawText: string;
  result: OcrResult;
  overallConfidence: number;
}) {
  if (!shouldWriteOcrDebugArtifacts()) {
    return;
  }

  const debugRoot = resolveLocalDirectory(
    process.env.OCR_DEBUG_DIR,
    path.join(process.cwd(), ".cache", "ocr-debug"),
  );

  await mkdir(debugRoot, { recursive: true });

  const fileName = `${Date.now()}-${sanitizeFileName(input.fileName)}-${crypto
    .randomUUID()
    .slice(0, 8)}.json`;
  const outputPath = path.join(debugRoot, fileName);

  await writeFile(
    outputPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        fileName: input.fileName,
        mimeType: input.mimeType ?? "",
        overallConfidence,
        rawText,
        parsed: result,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.info(`[OCR debug] Saved raw OCR output to ${outputPath}`);
  console.info(`[OCR debug] Raw OCR text for ${input.fileName}:\n${rawText}`);
}
