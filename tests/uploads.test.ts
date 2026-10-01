import assert from "node:assert/strict";
import test from "node:test";
import {
  detectExpenseUploadMimeType,
  validateExpenseUploadFile,
} from "../lib/uploads";
import { extractExpenseSchema } from "../lib/validation/expense";

test("extract expense schema requires a valid category id", () => {
  const parsed = extractExpenseSchema.safeParse({
    categoryId: "",
  });

  assert.equal(parsed.success, false);
});

test("upload validation accepts supported invoice file types", () => {
  const file = new File(["receipt"], "receipt.png", {
    type: "image/png",
  });

  assert.equal(validateExpenseUploadFile(file), null);
});

test("upload validation rejects unsupported file types", () => {
  const file = new File(["receipt"], "receipt.gif", {
    type: "image/gif",
  });

  assert.equal(
    validateExpenseUploadFile(file),
    "Only PDF, PNG, JPG, and WEBP files are allowed.",
  );
});

test("upload validation rejects oversized files", () => {
  const originalMaxUploadMb = process.env.MAX_UPLOAD_MB;

  process.env.MAX_UPLOAD_MB = "1";

  try {
    const file = new File([new Uint8Array(2 * 1024 * 1024)], "receipt.pdf", {
      type: "application/pdf",
    });

    assert.equal(validateExpenseUploadFile(file), "The uploaded file is too large.");
  } finally {
    if (originalMaxUploadMb === undefined) {
      delete process.env.MAX_UPLOAD_MB;
    } else {
      process.env.MAX_UPLOAD_MB = originalMaxUploadMb;
    }
  }
});

test("upload validation detects supported file signatures", () => {
  assert.equal(
    detectExpenseUploadMimeType(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])),
    "application/pdf",
  );
  assert.equal(
    detectExpenseUploadMimeType(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ),
    "image/png",
  );
  assert.equal(
    detectExpenseUploadMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])),
    "image/jpeg",
  );
  assert.equal(
    detectExpenseUploadMimeType(
      new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      ]),
    ),
    "image/webp",
  );
});

test("upload validation rejects files whose bytes do not match the claimed type", () => {
  const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "receipt.png", {
    type: "image/png",
  });

  assert.equal(
    validateExpenseUploadFile(
      file,
      new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
    ),
    "The uploaded file contents do not match the selected file type.",
  );
});

test("upload validation rejects unsupported file contents", () => {
  const file = new File(["receipt"], "receipt.png", {
    type: "image/png",
  });

  assert.equal(
    validateExpenseUploadFile(file, new Uint8Array([0x72, 0x65, 0x63, 0x65])),
    "The uploaded file is not a valid PDF, PNG, JPG, or WEBP file.",
  );
});
