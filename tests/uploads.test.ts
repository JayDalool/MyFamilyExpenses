import assert from "node:assert/strict";
import test from "node:test";
import { validateExpenseUploadFile } from "../lib/uploads";
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
