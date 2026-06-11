import assert from "node:assert/strict";
import test from "node:test";
import { OcrConfigError, OcrProviderError } from "../lib/ocr/ocr-errors";
import {
  hasAnyOcrField,
  parseInvoiceFieldsFromText,
} from "../lib/ocr/ocr-parsing";
import {
  extractInvoiceData,
  resolveOcrProviderName,
  runExtraction,
} from "../lib/ocr/ocr.service";
import { MockOcrEngine } from "../lib/ocr/mock-ocr-engine";
import { TesseractOcrEngine } from "../lib/ocr/tesseract-ocr-engine";
import { PaddleOcrEngine } from "../lib/ocr/paddle-ocr-engine";
import { normalizeConfidence } from "../lib/ocr/normalize";

function withEnv(
  overrides: Record<string, string | undefined>,
  run: () => void | Promise<void>,
) {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    original[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const key of Object.keys(overrides)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  };
  return Promise.resolve()
    .then(run)
    .finally(restore);
}

test("mock OCR service returns invoice fields", async () => {
  const originalProvider = process.env.OCR_PROVIDER;
  process.env.OCR_PROVIDER = "mock";

  const result = await extractInvoiceData({
    fileName: "receipt.pdf",
  });

  assert.match(result.invoiceNumber, /^MOCK-/);
  assert.match(result.invoiceDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof result.amount, "number");
  assert.equal(result.provider, "mock");

  if (originalProvider === undefined) {
    delete process.env.OCR_PROVIDER;
  } else {
    process.env.OCR_PROVIDER = originalProvider;
  }
});

test("mock OCR engine returns recognition-only output", async () => {
  const engine = new MockOcrEngine();
  const result = await engine.recognize({
    fileName: "receipt.pdf",
  });

  assert.equal(engine.name, "mock");
  assert.equal(result.provider, engine.name);
  assert.equal(typeof result.rawText, "string");
  assert.ok(result.rawText.length > 0);
  assert.ok(Array.isArray(result.blocks));
  // Recognition output must not carry structured invoice fields.
  assert.equal("invoiceNumber" in result, false);
  assert.equal("amount" in result, false);
});

test("the parser (not the engine) owns structured field extraction", async () => {
  const engine = new MockOcrEngine();
  const recognition = await engine.recognize({ fileName: "receipt.png" });

  const parsed = parseInvoiceFieldsFromText(
    recognition.rawText,
    recognition.provider,
    recognition.meanScore,
  );

  assert.match(parsed.invoiceNumber, /^MOCK-/);
  assert.match(parsed.invoiceDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof parsed.amount, "number");
  assert.equal(parsed.provider, "mock");
});

test("extract response stays compatible with the wizard contract", async () => {
  await withEnv({ OCR_PROVIDER: "mock", NODE_ENV: "test" }, async () => {
    const result = await extractInvoiceData({ fileName: "receipt.png" });

    // The original five wizard-contract keys must still be present (additive
    // Stage A fields are allowed alongside them).
    for (const key of ["amount", "confidence", "invoiceDate", "invoiceNumber", "provider"]) {
      assert.ok(key in result, `missing core key: ${key}`);
    }
    // Stage A additive fields.
    for (const key of ["receiptType", "multipleReceipts", "warnings", "candidates"]) {
      assert.ok(key in result, `missing Stage A key: ${key}`);
    }
    assert.deepEqual(
      Object.keys(result.confidence).sort(),
      ["amount", "invoiceDate", "invoiceNumber"],
    );
  });
});

test("unknown OCR_PROVIDER fails closed", async () => {
  await withEnv({ OCR_PROVIDER: "paddleocr", NODE_ENV: "test" }, async () => {
    assert.throws(() => resolveOcrProviderName(), (error: unknown) => error instanceof OcrConfigError);
    await assert.rejects(
      extractInvoiceData({ fileName: "receipt.png" }),
      (error: unknown) => error instanceof OcrConfigError,
    );
  });
});

test("mock provider is prohibited in production", async () => {
  await withEnv({ OCR_PROVIDER: "mock", NODE_ENV: "production" }, () => {
    assert.throws(
      () => resolveOcrProviderName(),
      (error: unknown) => error instanceof OcrConfigError,
    );
  });
});

test("parser extracts invoice fields from receipt text", () => {
  const parsed = parseInvoiceFieldsFromText(
    `
      Invoice No: INV-1001
      Date: 2026-04-22
      Grand Total: $42.50
    `,
    "tesseract",
    92,
  );

  assert.equal(parsed.invoiceNumber, "INV-1001");
  assert.equal(parsed.invoiceDate, "2026-04-22");
  assert.equal(parsed.amount, 42.5);
  assert.equal(hasAnyOcrField(parsed), true);
});

test("parser returns partial values when only total is found", () => {
  const parsed = parseInvoiceFieldsFromText(
    "Thank you for your purchase\nTotal Due 18.99",
    "tesseract",
    65,
  );

  assert.equal(parsed.invoiceNumber, "");
  assert.equal(parsed.invoiceDate, "");
  assert.equal(parsed.amount, 18.99);
  assert.equal(parsed.confidence.amount > 0, true);
  assert.equal(parsed.confidence.invoiceNumber, 0);
});

test("parser prefers grand total over subtotal and tax lines", () => {
  const parsed = parseInvoiceFieldsFromText(
    `
      Subtotal 12.40
      Tax 1.60
      Grand Total 14.00
    `,
    "tesseract",
    88,
  );

  assert.equal(parsed.amount, 14);
});

test("parser prefers amount paid over tax-only lines", () => {
  const parsed = parseInvoiceFieldsFromText(
    `
      HST 1.82
      Amount Paid $15.82
      Change 0.00
    `,
    "tesseract",
    84,
  );

  assert.equal(parsed.amount, 15.82);
});

test("parser supports common receipt date formats", () => {
  const slashDate = parseInvoiceFieldsFromText(
    "Transaction Date 04/23/26 09:41",
    "tesseract",
    81,
  );
  const dayMonthDate = parseInvoiceFieldsFromText(
    "Receipt Date 23.04.2026",
    "tesseract",
    81,
  );

  assert.equal(slashDate.invoiceDate, "2026-04-23");
  assert.equal(dayMonthDate.invoiceDate, "2026-04-23");
});

test("parser detects transaction numbers and ignores store and phone numbers", () => {
  const parsed = parseInvoiceFieldsFromText(
    `
      Store No: 104
      Phone: 204-555-1212
      Trans No: 874411
      Amount Paid: 21.55
    `,
    "tesseract",
    86,
  );

  assert.equal(parsed.invoiceNumber, "874411");
});

test("parser detects check and order number labels", () => {
  const checkParsed = parseInvoiceFieldsFromText(
    "Check No: 009812\nTotal 42.50",
    "tesseract",
    86,
  );
  const orderParsed = parseInvoiceFieldsFromText(
    "Order No. A-44591\nTotal 19.99",
    "tesseract",
    86,
  );

  assert.equal(checkParsed.invoiceNumber, "009812");
  assert.equal(orderParsed.invoiceNumber, "A-44591");
});

test("parser handles Canadian grocery receipt patterns", () => {
  const parsed = parseInvoiceFieldsFromText(
    `
      WALMART CANADA
      Date 23/04/2026 14:53
      Receipt # 004615-312-001
      Subtotal 45.12
      HST 5.87
      Total 50.99
      Interac 50.99
    `,
    "tesseract",
    89,
  );

  assert.equal(parsed.invoiceDate, "2026-04-23");
  assert.equal(parsed.invoiceNumber, "004615-312-001");
  assert.equal(parsed.amount, 50.99);
});

test("parser handles Canadian restaurant receipt patterns", () => {
  const parsed = parseInvoiceFieldsFromText(
    `
      THE KEG
      Transaction Date Apr 23 2026 19:41
      Cheque # 142
      Subtotal 68.00
      HST 8.84
      TOTAL 76.84
      VISA 76.84
    `,
    "tesseract",
    88,
  );

  assert.equal(parsed.invoiceDate, "2026-04-23");
  assert.equal(parsed.invoiceNumber, "142");
  assert.equal(parsed.amount, 76.84);
});

test("parser handles Canadian pharmacy receipt patterns", () => {
  const parsed = parseInvoiceFieldsFromText(
    `
      SHOPPERS DRUG MART
      Invoice Date 2026/04/23
      Ref # RX-22841
      Subtotal 11.99
      GST 0.60
      Total Due 12.59
    `,
    "tesseract",
    87,
  );

  assert.equal(parsed.invoiceDate, "2026-04-23");
  assert.equal(parsed.invoiceNumber, "RX-22841");
  assert.equal(parsed.amount, 12.59);
});

test("parser handles Canadian gas station receipt patterns", () => {
  const parsed = parseInvoiceFieldsFromText(
    `
      ESSO
      Purchase Date 23 Apr 2026 07:14
      Trans No 081552
      Subtotal 58.15
      HST 7.56
      Amount Paid 65.71
      Interac 65.71
    `,
    "tesseract",
    9,
  );

  assert.equal(parsed.invoiceDate, "2026-04-23");
  assert.equal(parsed.invoiceNumber, "081552");
  assert.equal(parsed.amount, 65.71);
});

test("parser avoids Canadian tax ids and terminal ids when a receipt number exists", () => {
  const parsed = parseInvoiceFieldsFromText(
    `
      COSTCO WHOLESALE CANADA
      Store No 567
      Terminal ID 998211
      Authorization 123456
      HST No 123456789RT0001
      Date 04-23-2026 16:10
      Receipt Number 456712
      Subtotal 129.99
      HST 6.50
      Total 136.49
      Mastercard 136.49
    `,
    "tesseract",
    91,
  );

  assert.equal(parsed.invoiceDate, "2026-04-23");
  assert.equal(parsed.invoiceNumber, "456712");
  assert.equal(parsed.amount, 136.49);
});

test("parser prefers Canadian day-first dates when the receipt context is Canadian", () => {
  const parsed = parseInvoiceFieldsFromText(
    `
      CANADIAN TIRE
      Transaction Date 05/04/2026
      Receipt No 00119
      HST 1.20
      Total 14.99
      Interac 14.99
    `,
    "tesseract",
    85,
  );

  assert.equal(parsed.invoiceDate, "2026-04-05");
  assert.equal(parsed.invoiceNumber, "00119");
});

test("parser keeps supporting US-style ambiguous dates when no Canadian context exists", () => {
  const parsed = parseInvoiceFieldsFromText(
    `
      Order Date 05-04-2026
      Order # A-5512
      Total Due 19.95
    `,
    "tesseract",
    85,
  );

  assert.equal(parsed.invoiceDate, "2026-05-04");
  assert.equal(parsed.invoiceNumber, "A-5512");
  assert.equal(parsed.amount, 19.95);
});

test("parser handles Canadian split labels and spaced numeric dates", () => {
  const parsed = parseInvoiceFieldsFromText(
    `
      LOBLAWS
      Transaction Date
      2026 04 23 13:14
      RCPT
      No. 1234567890
      Store # 1123
      HST REG 812345678RT0001
      Total 64.82
      Debit 64.82
    `,
    "tesseract",
    87,
  );

  assert.equal(parsed.invoiceDate, "2026-04-23");
  assert.equal(parsed.invoiceNumber, "1234567890");
  assert.equal(parsed.amount, 64.82);
});

test("parser handles Canadian POS shorthand labels and month-name dates", () => {
  const parsed = parseInvoiceFieldsFromText(
    `
      RONA
      DATE/TIME 23-APR-2026 16:22
      TRN# 0098453311
      Store # 457
      Terminal ID 000771
      HST # 123456789RT0001
      TOTAL 89.22
      VISA 89.22
    `,
    "tesseract",
    88,
  );

  assert.equal(parsed.invoiceDate, "2026-04-23");
  assert.equal(parsed.invoiceNumber, "0098453311");
  assert.equal(parsed.amount, 89.22);
});

test("parser tolerates common OCR date character confusion on Canadian receipts", () => {
  const parsed = parseInvoiceFieldsFromText(
    `
      PHARMASAVE
      Invoice Date 2O26/O4/23
      Invoice Number INV-33281
      GST 0.87
      Total Due 18.44
    `,
    "tesseract",
    82,
  );

  assert.equal(parsed.invoiceDate, "2026-04-23");
  assert.equal(parsed.invoiceNumber, "INV-33281");
  assert.equal(parsed.amount, 18.44);
});

test("parser prefers receipt ids over payment reference numbers on Canadian card slips", () => {
  const parsed = parseInvoiceFieldsFromText(
    `
      CANADIAN SUPERSTORE
      Date 23/04/2026
      Ref # 778899
      Approval Code 441122
      Receipt Number 00482155
      HST 1.33
      Total 11.49
      Interac 11.49
    `,
    "tesseract",
    86,
  );

  assert.equal(parsed.invoiceDate, "2026-04-23");
  assert.equal(parsed.invoiceNumber, "00482155");
  assert.equal(parsed.amount, 11.49);
});

test("tesseract engine rejects pdf files with a clear error", async () => {
  const engine = new TesseractOcrEngine();

  await assert.rejects(
    engine.recognize({
      fileName: "receipt.pdf",
      mimeType: "application/pdf",
    }),
    (error: unknown) =>
      error instanceof OcrProviderError &&
      error.code === "PDF_NOT_SUPPORTED",
  );
});

// ── Engine score normalization (0–1 contract) ────────────────────────────────

test("normalizeConfidence maps native units into the 0–1 range", () => {
  // Tesseract-style 0–100 scores are scaled down.
  assert.equal(normalizeConfidence(92), 0.92);
  assert.equal(normalizeConfidence(100), 1);
  // Already-normalized 0–1 scores pass through.
  assert.equal(normalizeConfidence(0.8), 0.8);
  assert.equal(normalizeConfidence(0), 0);
  assert.equal(normalizeConfidence(1), 1);
  // Out-of-range values clamp into [0, 1].
  assert.equal(normalizeConfidence(150), 1);
  assert.equal(normalizeConfidence(-5), 0);
  // Unsafe inputs fall back to 0.
  assert.equal(normalizeConfidence(Number.NaN), 0);
  assert.equal(normalizeConfidence(Infinity), 0);
  assert.equal(normalizeConfidence(null), 0);
  assert.equal(normalizeConfidence(undefined), 0);
});

test("mock engine reports a normalized 0–1 meanScore", async () => {
  const engine = new MockOcrEngine();
  const result = await engine.recognize({ fileName: "receipt.png" });

  assert.ok(result.meanScore >= 0 && result.meanScore <= 1);
});

test("engine block scores, when present, are in the 0–1 range", async () => {
  const engine = new MockOcrEngine();
  const result = await engine.recognize({ fileName: "receipt.png" });

  for (const block of result.blocks) {
    assert.ok(
      block.score >= 0 && block.score <= 1,
      `block score ${block.score} must be normalized to 0–1`,
    );
  }
});

// ── runExtraction internal envelope ──────────────────────────────────────────

test("runExtraction returns the full internal envelope", async () => {
  await withEnv({ OCR_PROVIDER: "mock", NODE_ENV: "test" }, async () => {
    const envelope = await runExtraction({ fileName: "receipt.png" });

    // Three seams: raw recognition, parsed fields, and the UI projection.
    assert.deepEqual(
      Object.keys(envelope).sort(),
      ["engineResult", "parserResult", "response"],
    );

    // engineResult carries provider-neutral recognition with a normalized score.
    const { engineResult } = envelope;
    assert.equal(typeof engineResult.rawText, "string");
    assert.equal(engineResult.provider, "mock");
    assert.equal(engineResult.modelVersion, "mock-1");
    assert.equal(typeof engineResult.durationMs, "number");
    assert.ok(engineResult.meanScore >= 0 && engineResult.meanScore <= 1);
    // Recognition output must not carry structured invoice fields.
    assert.equal("invoiceNumber" in engineResult, false);
    assert.equal("amount" in engineResult, false);

    // parserResult owns the structured parsed fields.
    assert.match(envelope.parserResult.invoiceNumber, /^MOCK-/);
    assert.match(envelope.parserResult.invoiceDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof envelope.parserResult.amount, "number");

    // response keeps the wizard-visible core fields (plus additive Stage A data).
    for (const key of ["amount", "confidence", "invoiceDate", "invoiceNumber", "provider"]) {
      assert.ok(key in envelope.response, `missing core key: ${key}`);
    }
    assert.deepEqual(envelope.response, envelope.parserResult);
  });
});

// ── PaddleOCR HTTP engine ────────────────────────────────────────────────────

const PADDLE_ENV = {
  OCR_PROVIDER: "paddle",
  OCR_SERVICE_URL: "http://ocr-test:8000",
  NODE_ENV: "test",
} as const;

function validPaddleDto() {
  return {
    text: "Invoice No: INV-7788\nDate: 2026-05-01\nGrand Total: $51.20",
    blocks: [
      {
        text: "Grand Total: $51.20",
        bbox: [
          [10, 20],
          [200, 20],
          [200, 48],
          [10, 48],
        ],
        score: 0.93,
      },
    ],
    meanScore: 0.9,
    modelVersion: "PP-OCRv4",
  };
}

// Swap global fetch for the duration of `run`, then restore.
function withFetch(
  stub: (input: unknown, init?: unknown) => Promise<Response>,
  run: () => Promise<void>,
) {
  const original = globalThis.fetch;
  globalThis.fetch = stub as typeof globalThis.fetch;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.fetch = original;
    });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const sampleBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

test("OCR_PROVIDER=paddle is a recognized provider", async () => {
  await withEnv(PADDLE_ENV, () => {
    assert.equal(resolveOcrProviderName(), "paddle");
  });
});

test("OCR_PROVIDER=paddle requires OCR_SERVICE_URL", async () => {
  await withEnv(
    { OCR_PROVIDER: "paddle", OCR_SERVICE_URL: undefined, NODE_ENV: "test" },
    async () => {
      // Name resolves, but constructing the engine fails closed without a URL.
      assert.equal(resolveOcrProviderName(), "paddle");
      await assert.rejects(
        extractInvoiceData({ fileName: "receipt.png", fileBytes: sampleBytes }),
        (error: unknown) => error instanceof OcrConfigError,
      );
    },
  );
});

test("paddle engine maps a valid service DTO to an EngineResult", async () => {
  await withEnv(PADDLE_ENV, async () => {
    await withFetch(
      async () => jsonResponse(validPaddleDto()),
      async () => {
        const engine = new PaddleOcrEngine();
        const result = await engine.recognize({
          fileName: "receipt.png",
          mimeType: "image/png",
          fileBytes: sampleBytes,
        });

        assert.equal(result.provider, "paddle");
        assert.equal(result.modelVersion, "PP-OCRv4");
        assert.match(result.rawText, /INV-7788/);
        assert.equal(result.blocks.length, 1);
        // Polygon → axis-aligned bbox [minX, minY, maxX, maxY].
        assert.deepEqual(result.blocks[0].bbox, [10, 20, 200, 48]);
        assert.equal(typeof result.durationMs, "number");
        // Recognition output carries no structured invoice fields.
        assert.equal("invoiceNumber" in result, false);
      },
    );
  });
});

test("paddle engine normalizes and clamps scores to 0–1", async () => {
  await withEnv(PADDLE_ENV, async () => {
    const dto = validPaddleDto();
    // Service mis-reports out-of-range scores; the engine must clamp/normalize.
    dto.meanScore = 95; // 0–100 style
    dto.blocks[0].score = 1.5; // above range
    await withFetch(
      async () => jsonResponse(dto),
      async () => {
        const engine = new PaddleOcrEngine();
        const result = await engine.recognize({
          fileName: "receipt.png",
          fileBytes: sampleBytes,
        });

        assert.ok(result.meanScore >= 0 && result.meanScore <= 1);
        assert.equal(result.meanScore, 0.95);
        for (const block of result.blocks) {
          assert.ok(block.score >= 0 && block.score <= 1);
        }
      },
    );
  });
});

test("paddle engine rejects a malformed service response", async () => {
  await withEnv(PADDLE_ENV, async () => {
    await withFetch(
      async () => jsonResponse({ unexpected: true }),
      async () => {
        const engine = new PaddleOcrEngine();
        await assert.rejects(
          engine.recognize({ fileName: "receipt.png", fileBytes: sampleBytes }),
          (error: unknown) =>
            error instanceof OcrProviderError && error.code === "OCR_FAILED",
        );
      },
    );
  });
});

test("paddle engine surfaces a controlled error on HTTP 5xx", async () => {
  await withEnv(PADDLE_ENV, async () => {
    await withFetch(
      async () => new Response("upstream error", { status: 503 }),
      async () => {
        const engine = new PaddleOcrEngine();
        await assert.rejects(
          engine.recognize({ fileName: "receipt.png", fileBytes: sampleBytes }),
          (error: unknown) =>
            error instanceof OcrProviderError && error.code === "OCR_FAILED",
        );
      },
    );
  });
});

test("paddle engine surfaces a controlled error on network failure", async () => {
  await withEnv(PADDLE_ENV, async () => {
    await withFetch(
      async () => {
        throw new Error("ECONNREFUSED");
      },
      async () => {
        const engine = new PaddleOcrEngine();
        await assert.rejects(
          engine.recognize({ fileName: "receipt.png", fileBytes: sampleBytes }),
          (error: unknown) =>
            error instanceof OcrProviderError && error.code === "OCR_FAILED",
        );
      },
    );
  });
});

test("paddle engine surfaces a controlled error on timeout (abort)", async () => {
  await withEnv(PADDLE_ENV, async () => {
    await withFetch(
      async () => {
        const abortError = new Error("The operation was aborted");
        abortError.name = "AbortError";
        throw abortError;
      },
      async () => {
        const engine = new PaddleOcrEngine();
        await assert.rejects(
          engine.recognize({ fileName: "receipt.png", fileBytes: sampleBytes }),
          (error: unknown) =>
            error instanceof OcrProviderError &&
            error.code === "OCR_FAILED" &&
            /timed out/i.test(error.message),
        );
      },
    );
  });
});

test("runExtraction with the paddle engine returns the full envelope", async () => {
  await withEnv(PADDLE_ENV, async () => {
    await withFetch(
      async () => jsonResponse(validPaddleDto()),
      async () => {
        const envelope = await runExtraction({
          fileName: "receipt.png",
          fileBytes: sampleBytes,
        });

        assert.deepEqual(
          Object.keys(envelope).sort(),
          ["engineResult", "parserResult", "response"],
        );
        assert.equal(envelope.engineResult.provider, "paddle");
        assert.ok(
          envelope.engineResult.meanScore >= 0 &&
            envelope.engineResult.meanScore <= 1,
        );
        // Parser owns structured fields, derived from the engine's rawText.
        assert.equal(envelope.parserResult.invoiceNumber, "INV-7788");
        assert.equal(envelope.parserResult.amount, 51.2);
        // Visible response keeps the wizard-compatible core fields.
        for (const key of ["amount", "confidence", "invoiceDate", "invoiceNumber", "provider"]) {
          assert.ok(key in envelope.response, `missing core key: ${key}`);
        }
        assert.equal(envelope.response.provider, "paddle");
      },
    );
  });
});
