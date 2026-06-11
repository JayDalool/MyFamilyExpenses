import { z } from "zod";
import { OcrConfigError, OcrProviderError } from "@/lib/ocr/ocr-errors";
import { normalizeConfidence } from "@/lib/ocr/normalize";
import type { EngineResult, OcrBlock, OcrEngine, OcrInput } from "@/lib/ocr/types";

// Total OCR budget for a single Paddle request (Blocker D: 5–8 s). Configurable
// via OCR_TIMEOUT_MS; clamped so a misconfiguration can't disable the timeout.
const DEFAULT_TIMEOUT_MS = 7_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 8_000;

// Response hardening (Blocker D): fail closed on absurd payloads rather than
// letting a compromised/buggy service flood the parser.
const MAX_BLOCKS = 2_000;
const MAX_RAWTEXT_CHARS = 50_000;

// The app-owned DTO the Paddle service must return. We validate this shape and
// never expose the raw Paddle response to the rest of the app. bbox is a polygon
// (4 points) on the wire; the engine flattens it to the app's axis-aligned bbox.
const pointSchema = z.tuple([z.number(), z.number()]);

const paddleBlockSchema = z.object({
  text: z.string(),
  bbox: z.array(pointSchema).optional(),
  score: z.number(),
});

const paddleResponseSchema = z.object({
  text: z.string(),
  blocks: z.array(paddleBlockSchema),
  meanScore: z.number(),
  modelVersion: z.string().nullish(),
});

type PaddleBlock = z.infer<typeof paddleBlockSchema>;

function resolveServiceUrl() {
  const url = process.env.OCR_SERVICE_URL?.trim();

  if (!url) {
    throw new OcrConfigError(
      'OCR_PROVIDER="paddle" requires OCR_SERVICE_URL to point at the internal OCR service (e.g. http://ocr:8000).',
    );
  }

  return url.replace(/\/+$/, "");
}

function resolveTimeoutMs() {
  const raw = Number(process.env.OCR_TIMEOUT_MS);

  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }

  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, raw));
}

// Polygon ([[x,y]×n]) → app axis-aligned bbox [minX, minY, maxX, maxY].
function polygonToBbox(
  points: PaddleBlock["bbox"],
): OcrBlock["bbox"] {
  if (!points || points.length === 0) {
    return undefined;
  }

  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);

  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function mapToEngineResult(
  dto: z.infer<typeof paddleResponseSchema>,
  durationMs: number,
): EngineResult {
  const blocks: OcrBlock[] = dto.blocks.slice(0, MAX_BLOCKS).map((block) => ({
    text: block.text,
    bbox: polygonToBbox(block.bbox),
    // Defense in depth: scores are normalized service-side, but we re-normalize
    // at the boundary so the rest of the app can always trust 0–1 units.
    score: normalizeConfidence(block.score),
  }));

  return {
    rawText: dto.text.slice(0, MAX_RAWTEXT_CHARS),
    blocks,
    meanScore: normalizeConfidence(dto.meanScore),
    provider: "paddle",
    modelVersion: dto.modelVersion ?? null,
    durationMs,
  };
}

// HTTP engine that talks to an internal PaddleOCR sidecar. Recognition only —
// structured field parsing stays Node-owned in the ReceiptParser.
export class PaddleOcrEngine implements OcrEngine {
  readonly name = "paddle";
  private readonly serviceUrl: string;
  private readonly timeoutMs: number;

  constructor() {
    // Fails closed at selection time if the service URL is not configured.
    this.serviceUrl = resolveServiceUrl();
    this.timeoutMs = resolveTimeoutMs();
  }

  async recognize(input: OcrInput): Promise<EngineResult> {
    if (!input.fileBytes || input.fileBytes.length === 0) {
      // Paddle receives bytes, never filesystem paths.
      throw new OcrProviderError(
        "OCR_FAILED",
        "No image data was provided for OCR.",
      );
    }

    const form = new FormData();
    const blob = new Blob([new Uint8Array(input.fileBytes)], {
      type: input.mimeType || "application/octet-stream",
    });
    form.append("file", blob, input.fileName || "upload");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await fetch(`${this.serviceUrl}/ocr`, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
    } catch (error) {
      // Timeout (abort) or network failure → controlled OCR error. Never
      // fabricate data and never fall back to mock.
      const reason =
        error instanceof Error && error.name === "AbortError"
          ? `timed out after ${this.timeoutMs}ms`
          : "could not be reached";
      throw new OcrProviderError(
        "OCR_FAILED",
        `The OCR service ${reason}. You can continue and enter the invoice fields manually.`,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      // 4xx (invalid file) and 5xx alike: surface a controlled error. The route
      // already validated the upload, so this is best-effort failure, not fallback.
      throw new OcrProviderError(
        "OCR_FAILED",
        `The OCR service returned an error (HTTP ${response.status}). You can continue and enter the invoice fields manually.`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new OcrProviderError(
        "OCR_FAILED",
        "The OCR service returned an unreadable response.",
      );
    }

    const parsed = paddleResponseSchema.safeParse(payload);

    if (!parsed.success) {
      // Do not log the raw response (may contain OCR text). Codes/shape only.
      throw new OcrProviderError(
        "OCR_FAILED",
        "The OCR service returned an unexpected response shape.",
      );
    }

    return mapToEngineResult(parsed.data, Date.now() - startedAt);
  }
}
