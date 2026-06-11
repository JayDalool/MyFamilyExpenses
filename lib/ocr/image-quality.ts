// Lightweight image-quality assessment for OCR. Parses width/height directly
// from the file header (no decode, no new dependencies) for the formats the
// upload allowlist accepts (PNG / JPEG / WEBP). Used to give friendlier guidance
// when OCR can't read a receipt — NOT to hard-reject uploads. Manual entry always
// stays available, and a readable-but-small image is never blocked here.

export type ImageDimensions = { width: number; height: number };

// Below any of these, an image is unlikely to OCR well. Deliberately used only to
// pick a better message after OCR finds nothing — never to pre-reject.
export const MIN_OCR_WIDTH = 600;
export const MIN_OCR_HEIGHT = 400;
export const MIN_OCR_PIXELS = 250_000;

function readPngDimensions(view: DataView): ImageDimensions | null {
  // 8-byte signature, then IHDR chunk (length + "IHDR" + width + height).
  if (view.byteLength < 24) return null;
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (view.getUint32(0) !== 0x89_50_4e_47) return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function readJpegDimensions(view: DataView): ImageDimensions | null {
  if (view.byteLength < 4) return null;
  if (view.getUint16(0) !== 0xff_d8) return null; // SOI

  let offset = 2;
  while (offset + 9 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = view.getUint8(offset + 1);

    // Standalone markers (no length): padding 0xFF, RSTn, SOI, EOI.
    if (marker === 0xff || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }

    const segmentLength = view.getUint16(offset + 2);
    if (segmentLength < 2) return null;

    // SOF markers carry frame dimensions. Exclude DHT(C4)/JPG(C8)/DAC(CC).
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;

    if (isSof) {
      if (offset + 9 > view.byteLength) return null;
      const height = view.getUint16(offset + 5);
      const width = view.getUint16(offset + 7);
      return { width, height };
    }

    offset += 2 + segmentLength;
  }

  return null;
}

function readWebpDimensions(view: DataView): ImageDimensions | null {
  if (view.byteLength < 30) return null;
  // "RIFF" .... "WEBP"
  if (view.getUint32(0) !== 0x52_49_46_46) return null;
  if (view.getUint32(8) !== 0x57_45_42_50) return null;

  const fourcc = view.getUint32(12);

  // VP8X (extended): 24-bit (width-1) and (height-1) little-endian at offset 24.
  if (fourcc === 0x56_50_38_58) {
    const w = view.getUint8(24) | (view.getUint8(25) << 8) | (view.getUint8(26) << 16);
    const h = view.getUint8(27) | (view.getUint8(28) << 8) | (view.getUint8(29) << 16);
    return { width: w + 1, height: h + 1 };
  }

  // VP8 (lossy): 16-bit width/height at offset 26 (14 significant bits).
  if (fourcc === 0x56_50_38_20) {
    const w = view.getUint16(26, true) & 0x3fff;
    const h = view.getUint16(28, true) & 0x3fff;
    return { width: w, height: h };
  }

  // VP8L (lossless): 14-bit (width-1)/(height-1) packed from offset 21.
  if (fourcc === 0x56_50_38_4c) {
    const b0 = view.getUint8(21);
    const b1 = view.getUint8(22);
    const b2 = view.getUint8(23);
    const b3 = view.getUint8(24);
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  }

  return null;
}

/**
 * Parse image dimensions from raw bytes for PNG / JPEG / WEBP. Returns null when
 * the format isn't recognized or the header is too short — callers must treat
 * null as "unknown" (never as low quality), so unparseable inputs are not
 * penalized.
 */
export function getImageDimensions(
  bytes: Uint8Array | undefined | null,
): ImageDimensions | null {
  if (!bytes || bytes.length < 24) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const dims =
    readPngDimensions(view) ?? readJpegDimensions(view) ?? readWebpDimensions(view);

  if (!dims || dims.width <= 0 || dims.height <= 0) return null;

  return dims;
}

/**
 * True only when dimensions are known AND fall below the OCR-friendly minimums.
 * Unknown dimensions (null) are NOT low quality — we never block on uncertainty.
 */
export function isLowQualityForOcr(dimensions: ImageDimensions | null): boolean {
  if (!dimensions) return false;

  return (
    dimensions.width < MIN_OCR_WIDTH ||
    dimensions.height < MIN_OCR_HEIGHT ||
    dimensions.width * dimensions.height < MIN_OCR_PIXELS
  );
}

/** Convenience: assess raw bytes in one call. */
export function isLowQualityImage(bytes: Uint8Array | undefined | null): boolean {
  return isLowQualityForOcr(getImageDimensions(bytes));
}
