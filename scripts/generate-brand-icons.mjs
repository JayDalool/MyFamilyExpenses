/**
 * Regenerate every raster brand asset from public/brand/logo-mark.svg.
 *
 * Usage:  npm run brand:icons
 *
 * Workflow when the real logo is ready:
 *   1. Replace public/brand/logo-mark.svg (square) and public/brand/logo.svg.
 *   2. Run `npm run brand:icons`.
 *   3. Commit + deploy. iOS home-screen icon, Android/PWA icons, and the
 *      favicon all update. No code changes needed.
 *
 * Outputs:
 *   public/brand/apple-touch-icon.png  180x180, flattened onto the brand color
 *                                      (iOS dislikes transparency; it fills
 *                                      transparent corners with black).
 *   public/brand/icon-192.png          PWA manifest icon (purpose "any").
 *   public/brand/icon-512.png          PWA manifest icon (purpose "any").
 *   public/brand/maskable-512.png      Full-bleed background with the mark at
 *                                      80% so Android's adaptive mask never
 *                                      clips the artwork.
 *   public/favicon.ico                 16+32+48 PNG-compressed ICO.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.join(import.meta.dirname, "..");
const BRAND_DIR = path.join(ROOT, "public", "brand");
const MARK_SVG = path.join(BRAND_DIR, "logo-mark.svg");

// Flatten/matte color for apple-touch-icon and the maskable canvas. Keep in
// sync with the `brand.600`-ish tone the mark uses as its own background.
const BRAND_BG = "#2e8b57";

/** Wrap PNG buffers into a valid .ico container (PNG-in-ICO, supported everywhere modern). */
function buildIco(pngs) {
  const HEADER = 6;
  const ENTRY = 16;
  const header = Buffer.alloc(HEADER);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);

  const entries = [];
  let offset = HEADER + ENTRY * pngs.length;
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(ENTRY);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }

  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

async function main() {
  const svg = await readFile(MARK_SVG);
  await mkdir(BRAND_DIR, { recursive: true });

  const png = (size) => sharp(svg, { density: 300 }).resize(size, size).png();

  // PWA "any" icons: keep the mark's own silhouette (transparent corners OK).
  await png(192).toFile(path.join(BRAND_DIR, "icon-192.png"));
  await png(512).toFile(path.join(BRAND_DIR, "icon-512.png"));

  // Apple touch icon: opaque, full-bleed. iOS rounds the corners itself.
  await sharp({
    create: { width: 180, height: 180, channels: 4, background: BRAND_BG },
  })
    .composite([{ input: await png(180).toBuffer() }])
    .flatten({ background: BRAND_BG })
    .png()
    .toFile(path.join(BRAND_DIR, "apple-touch-icon.png"));

  // Maskable: mark shrunk to 80% on a full-bleed brand canvas so Android's
  // adaptive shapes (circle/squircle/rounded square) never clip the artwork.
  const inner = Math.round(512 * 0.8);
  await sharp({
    create: { width: 512, height: 512, channels: 4, background: BRAND_BG },
  })
    .composite([
      {
        input: await png(inner).toBuffer(),
        left: Math.round((512 - inner) / 2),
        top: Math.round((512 - inner) / 2),
      },
    ])
    .flatten({ background: BRAND_BG })
    .png()
    .toFile(path.join(BRAND_DIR, "maskable-512.png"));

  // Favicon: multi-size PNG-in-ICO.
  const icoPngs = [];
  for (const size of [16, 32, 48]) {
    icoPngs.push({ size, data: await png(size).toBuffer() });
  }
  await writeFile(path.join(ROOT, "public", "favicon.ico"), buildIco(icoPngs));

  console.log("Brand icons regenerated from public/brand/logo-mark.svg");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
