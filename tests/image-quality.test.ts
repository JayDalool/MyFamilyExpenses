import assert from "node:assert/strict";
import test from "node:test";
import {
  getImageDimensions,
  isLowQualityForOcr,
  isLowQualityImage,
} from "../lib/ocr/image-quality";

// Build a minimal buffer with a valid PNG signature and an IHDR width/height at
// the fixed offsets the parser reads (16 = width, 20 = height, big-endian).
function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  const view = new DataView(bytes.buffer);
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

// Minimal JPEG: SOI + SOF0 frame header carrying precision/height/width, padded
// to >=24 bytes (the parser's minimum). Mirrors how the real header is read.
function jpegBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  const view = new DataView(bytes.buffer);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0); // SOI, SOF0, len, precision
  view.setUint16(7, height); // big-endian height
  view.setUint16(9, width); // big-endian width
  return bytes;
}

// Minimal WEBP VP8X (extended) header with 24-bit (width-1)/(height-1) LE.
function webpVp8xBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  bytes.set([0x56, 0x50, 0x38, 0x58], 12); // "VP8X"
  const w = width - 1;
  const h = height - 1;
  bytes[24] = w & 0xff;
  bytes[25] = (w >> 8) & 0xff;
  bytes[26] = (w >> 16) & 0xff;
  bytes[27] = h & 0xff;
  bytes[28] = (h >> 8) & 0xff;
  bytes[29] = (h >> 16) & 0xff;
  return bytes;
}

test("getImageDimensions reads PNG width/height", () => {
  assert.deepEqual(getImageDimensions(pngBytes(1200, 1600)), {
    width: 1200,
    height: 1600,
  });
});

test("getImageDimensions reads JPEG width/height (the reported 259x194 case)", () => {
  assert.deepEqual(getImageDimensions(jpegBytes(259, 194)), {
    width: 259,
    height: 194,
  });
  // This is exactly the image that failed OCR — it must be flagged low quality.
  assert.equal(isLowQualityImage(jpegBytes(259, 194)), true);
  // A large, clear JPEG must not be flagged.
  assert.equal(isLowQualityImage(jpegBytes(1200, 1600)), false);
});

test("getImageDimensions reads WEBP (VP8X) width/height", () => {
  assert.deepEqual(getImageDimensions(webpVp8xBytes(259, 194)), {
    width: 259,
    height: 194,
  });
  assert.equal(isLowQualityImage(webpVp8xBytes(259, 194)), true);
});

test("low-resolution images are flagged as low quality", () => {
  // The real failing example: 259x194.
  assert.equal(isLowQualityImage(pngBytes(259, 194)), true);
  // Width below threshold.
  assert.equal(isLowQualityImage(pngBytes(580, 800)), true);
  // Height below threshold.
  assert.equal(isLowQualityImage(pngBytes(900, 350)), true);
  // Above width/height but too few total pixels would also flag; here both
  // dimensions and pixel count are comfortably above the minimums.
  assert.equal(isLowQualityImage(pngBytes(1200, 1600)), false);
});

test("a clear, large image is not flagged", () => {
  assert.equal(isLowQualityForOcr({ width: 1024, height: 768 }), false);
});

test("unknown/unparseable bytes are treated as unknown, never low quality", () => {
  // Not a recognized image header → dimensions unknown → must NOT be flagged
  // (we never penalize uncertainty or hard-reject).
  const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(getImageDimensions(garbage), null);
  assert.equal(isLowQualityImage(garbage), false);
  assert.equal(isLowQualityImage(undefined), false);
  assert.equal(isLowQualityImage(null), false);
});

test("threshold boundaries behave as documented", () => {
  // Meets all three minimums (w>=600, h>=400, pixels>=250,000): not flagged.
  // 700x400 = 280,000 px.
  assert.equal(isLowQualityForOcr({ width: 700, height: 400 }), false);
  // One pixel under the width minimum flags.
  assert.equal(isLowQualityForOcr({ width: 599, height: 800 }), true);
  // Meets width/height but below the pixel floor: 600x401 = 240,600 < 250,000.
  assert.equal(isLowQualityForOcr({ width: 600, height: 401 }), true);
});
