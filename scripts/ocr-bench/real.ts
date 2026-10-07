// OCR scorecard on saved expenses (upgrade-plan step 6a). The values a person
// typed and saved are the answer; OCR is re-run on the stored receipt file.
//
// Jay runs this on the server, inside the app container:
//
//   docker compose exec app npm run ocr:bench:real -- --user osama@example.com
//   docker compose exec app npm run ocr:bench:real -- --household <uuid> --limit 200
//
// --user <email>       expenses entered by this user (repeatable)
// --household <uuid>   every expense in this household (repeatable)
// --limit <n>          newest n matching expenses (default 500)
//
// Scope agreed 2026-10-06: Jay's household and Osama's account, with Osama's
// agreement. Do not point it at other users' data.
//
// Privacy: prints totals only. No vendor names, amounts, dates, file names, OCR
// text or ids are printed or written anywhere. Read-only: it never writes to
// the database or the upload folder.

import { readFile } from "node:fs/promises";
import { prisma } from "../../lib/db/prisma";
import { getStoredExpenseAbsolutePath, getStoredExpenseMimeType } from "../../lib/expense-files";
import { formatTotals, scoreReceipt, totalScores, type ReceiptScore } from "../../lib/ocr/benchmark";
import { extractInvoiceData } from "../../lib/ocr/ocr.service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseArgs(argv: string[]): SavedExpenseScope {
  const emails: string[] = [];
  const householdIds: string[] = [];
  let limit = 500;
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i + 1];
    if (argv[i] === "--user" && value) {
      emails.push(value.trim().toLowerCase());
      i += 1;
    } else if (argv[i] === "--household" && value) {
      if (!UUID_PATTERN.test(value)) throw new Error("--household needs a household id (uuid).");
      householdIds.push(value);
      i += 1;
    } else if (argv[i] === "--limit" && value) {
      limit = Number.parseInt(value, 10);
      if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit needs a positive number.");
      i += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
    }
  }
  if (emails.length === 0 && householdIds.length === 0) {
    throw new Error("Pass at least one --user <email> or --household <uuid>.");
  }
  return { emails, householdIds, limit };
}

export type SavedExpenseScope = { emails: string[]; householdIds: string[]; limit: number };

type Bucket = { scores: ReceiptScore[]; failed: number };

/**
 * Score OCR against saved expenses in the given scope. Only expenses entered
 * by the named users or belonging to the named households are read.
 */
export async function benchmarkSavedExpenses(
  scope: SavedExpenseScope,
  db: Pick<typeof prisma, "user" | "expense"> = prisma,
  extract: typeof extractInvoiceData = extractInvoiceData,
) {
  const users = scope.emails.length
    ? await db.user.findMany({ where: { email: { in: scope.emails } }, select: { id: true } })
    : [];
  if (users.length < scope.emails.length) {
    throw new Error(`Found ${users.length} of ${scope.emails.length} users. Check the email addresses.`);
  }

  const expenses = await db.expense.findMany({
    where: {
      deletedAt: null,
      OR: [
        ...(users.length ? [{ userId: { in: users.map((user) => user.id) } }] : []),
        ...(scope.householdIds.length ? [{ householdId: { in: scope.householdIds } }] : []),
      ],
    },
    select: {
      filePath: true,
      invoiceDate: true,
      amountCents: true,
      taxCents: true,
      vendor: true,
    },
    orderBy: { createdAt: "desc" },
    take: scope.limit,
  });

  const byFileType = new Map<string, Bucket>();
  let pdfSkipped = 0;
  let fileMissing = 0;

  for (const expense of expenses) {
    const mimeType = getStoredExpenseMimeType(expense.filePath);
    if (mimeType === "application/pdf") {
      pdfSkipped += 1; // OCR does not read PDFs yet; step 6e.
      continue;
    }
    let fileBytes: Uint8Array;
    try {
      fileBytes = new Uint8Array(await readFile(getStoredExpenseAbsolutePath(expense.filePath)));
    } catch {
      fileMissing += 1;
      continue;
    }

    const bucket = byFileType.get(mimeType) ?? { scores: [], failed: 0 };
    byFileType.set(mimeType, bucket);
    try {
      const result = await extract({ fileName: "receipt", mimeType, fileBytes });
      bucket.scores.push(
        scoreReceipt(result, {
          amountCents: expense.amountCents,
          invoiceDate: expense.invoiceDate.toISOString().slice(0, 10),
          vendor: expense.vendor,
          taxCents: expense.taxCents,
        }),
      );
    } catch {
      bucket.failed += 1; // the error message can echo receipt content; do not print it
    }
  }

  const buckets = [...byFileType.values()];
  return {
    matched: expenses.length,
    pdfSkipped,
    fileMissing,
    byFileType,
    overall: totalScores(
      buckets.flatMap((bucket) => bucket.scores),
      buckets.reduce((sum, bucket) => sum + bucket.failed, 0),
    ),
  };
}

async function main() {
  const scope = parseArgs(process.argv.slice(2));
  const run = await benchmarkSavedExpenses(scope);

  console.log(`Saved expenses matched: ${run.matched} (limit ${scope.limit})`);
  console.log(`Skipped: ${run.pdfSkipped} PDF (not read yet), ${run.fileMissing} file missing`);
  for (const [mimeType, bucket] of run.byFileType) {
    console.log(`\n${formatTotals(`File type: ${mimeType}`, totalScores(bucket.scores, bucket.failed))}`);
  }
  console.log(`\n${formatTotals("Overall (saved expenses)", run.overall)}`);
}

if (require.main === module) {
  main()
    .then(() => prisma.$disconnect())
    .then(() => process.exit(0)) // the Tesseract worker keeps the event loop alive
    .catch(async (error) => {
      console.error(error instanceof Error ? error.message : error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
