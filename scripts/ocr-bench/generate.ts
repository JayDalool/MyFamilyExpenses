// Render the made-up receipts in tests/fixtures/receipt-images/receipts.ts into
// JPEG images for the OCR scorecard. The images are committed so every machine
// scores the same pixels; rerun this only when the receipt list changes:
//
//   npm run ocr:bench:generate
//
// Rendering uses sharp (SVG text -> raster) with the DejaVu Sans Mono font, so
// regenerated images can differ slightly on a machine without that font.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  IMAGE_VARIANTS,
  imageFileName,
  SYNTHETIC_RECEIPTS,
  type ImageVariant,
  type SyntheticReceipt,
} from "../../tests/fixtures/receipt-images/receipts";

const OUTPUT_DIR = path.join(process.cwd(), "tests", "fixtures", "receipt-images", "images");
const WIDTH = 720;
const LINE_HEIGHT = 34;
const FONT_SIZE = 24;
const PADDING = 40;

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function receiptSvg(receipt: SyntheticReceipt) {
  const height = PADDING * 2 + receipt.lines.length * LINE_HEIGHT;
  const text = receipt.lines
    .map(
      (line, index) =>
        `<text x="${PADDING}" y="${PADDING + (index + 1) * LINE_HEIGHT - 8}" xml:space="preserve">${escapeXml(line)}</text>`,
    )
    .join("");
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}">` +
      `<rect width="100%" height="100%" fill="#fbfaf6"/>` +
      `<g font-family="DejaVu Sans Mono, monospace" font-size="${FONT_SIZE}" fill="#1a1a1a">${text}</g>` +
      `</svg>`,
  );
}

// Deterministic noise so regenerating gives the same image on the same machine.
function seededNoise(width: number, height: number, seed: number) {
  let state = seed >>> 0 || 1;
  const pixels = Buffer.alloc(width * height);
  for (let i = 0; i < pixels.length; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    pixels[i] = (state >>> 0) % 100 < 6 ? 90 : 255; // ~6% dark speckles
  }
  return pixels;
}

async function renderVariant(receipt: SyntheticReceipt, variant: ImageVariant, seed: number) {
  const base = sharp(receiptSvg(receipt)).flatten({ background: "#fbfaf6" });

  switch (variant) {
    case "clean":
      return base.jpeg({ quality: 85 }).toBuffer();
    case "blur":
      return base.blur(1.4).jpeg({ quality: 75 }).toBuffer();
    case "tilt":
      return base.rotate(3, { background: "#d9d6cc" }).jpeg({ quality: 80 }).toBuffer();
    case "faded-noisy": {
      const faded = await base.linear(0.45, 120).greyscale().raw().toBuffer({ resolveWithObject: true });
      const { width, height } = faded.info;
      const noise = await sharp(seededNoise(width, height, seed), { raw: { width, height, channels: 1 } })
        .png()
        .toBuffer();
      return sharp(faded.data, { raw: faded.info })
        .composite([{ input: noise, blend: "multiply" }])
        .jpeg({ quality: 70 })
        .toBuffer();
    }
  }
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  let seed = 1;
  for (const receipt of SYNTHETIC_RECEIPTS) {
    for (const variant of IMAGE_VARIANTS) {
      const image = await renderVariant(receipt, variant, seed);
      seed += 1;
      await writeFile(path.join(OUTPUT_DIR, imageFileName(receipt, variant)), image);
    }
  }
  console.log(`Wrote ${SYNTHETIC_RECEIPTS.length * IMAGE_VARIANTS.length} images to ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
