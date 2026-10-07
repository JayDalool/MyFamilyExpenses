// OCR scorecard on the made-up receipt images (upgrade-plan step 6a).
//
//   npm run ocr:bench            # table per image condition and overall
//   npm run ocr:bench -- --json  # the same totals as JSON, for comparing runs
//
// Uses extractInvoiceData, the same entry point the upload route uses, so the
// OCR_PROVIDER / OCR_STRATEGY settings apply. Needs the Tesseract English model;
// the first run downloads it into .cache/tesseract unless TESSERACT_LANG_PATH
// points at a local copy.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { formatTotals, scoreReceipt, totalScores, type ReceiptScore } from "../../lib/ocr/benchmark";
import { extractInvoiceData } from "../../lib/ocr/ocr.service";
import {
  IMAGE_VARIANTS,
  imageFileName,
  SYNTHETIC_RECEIPTS,
} from "../../tests/fixtures/receipt-images/receipts";

const IMAGE_DIR = path.join(process.cwd(), "tests", "fixtures", "receipt-images", "images");

async function main() {
  const asJson = process.argv.includes("--json");
  const byVariant = new Map<string, { scores: ReceiptScore[]; failed: number }>();
  const all: ReceiptScore[] = [];
  let failed = 0;
  const startedAt = Date.now();

  for (const variant of IMAGE_VARIANTS) {
    const bucket = { scores: [] as ReceiptScore[], failed: 0 };
    byVariant.set(variant, bucket);
    for (const receipt of SYNTHETIC_RECEIPTS) {
      const fileName = imageFileName(receipt, variant);
      try {
        const fileBytes = new Uint8Array(await readFile(path.join(IMAGE_DIR, fileName)));
        const result = await extractInvoiceData({ fileName, mimeType: "image/jpeg", fileBytes });
        const score = scoreReceipt(result, receipt.expected);
        bucket.scores.push(score);
        all.push(score);
        if (!asJson) {
          const cells = Object.entries(score).map(([field, outcome]) => `${field}=${outcome}`);
          console.log(`${fileName.padEnd(44)} ${cells.join("  ")}`);
        }
      } catch (error) {
        bucket.failed += 1;
        failed += 1;
        console.error(`${fileName}: OCR failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const overall = totalScores(all, failed);
  const variants = Object.fromEntries(
    [...byVariant].map(([variant, bucket]) => [variant, totalScores(bucket.scores, bucket.failed)]),
  );
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  if (asJson) {
    console.log(JSON.stringify({ overall, variants, seconds: Number(seconds) }, null, 2));
  } else {
    for (const [variant, totals] of Object.entries(variants)) {
      console.log(`\n${formatTotals(`Condition: ${variant}`, totals)}`);
    }
    console.log(`\n${formatTotals("Overall (generated receipts)", overall)}`);
    console.log(`\n${seconds}s`);
  }
}

main()
  .then(() => process.exit(0)) // the Tesseract worker keeps the event loop alive
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
