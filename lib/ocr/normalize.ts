/**
 * Normalize an OCR confidence/score into the provider-neutral 0–1 range.
 *
 * Engines report scores in different units (Tesseract ~0–100, others 0–1), but
 * everything that crosses the engine boundary — `EngineResult.meanScore` and
 * every `OcrBlock.score` — MUST be 0–1 so the rest of the pipeline never has to
 * guess the unit.
 *
 * Rules:
 *  - values > 1 are treated as a 0–100 scale and divided by 100
 *  - the result is clamped to [0, 1]
 *  - NaN / null / undefined / non-finite inputs become 0
 */
export function normalizeConfidence(value: number | null | undefined): number {
  if (value === null || value === undefined || Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }

  const scaled = value > 1 ? value / 100 : value;

  return Math.max(0, Math.min(1, scaled));
}
