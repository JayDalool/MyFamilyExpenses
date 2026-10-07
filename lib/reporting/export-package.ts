import { stat } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { ZipFile } from "yazl";
import { getStoredExpenseAbsolutePath } from "@/lib/expense-files";
import { fromCents } from "@/lib/money";
import type { AccountantReport } from "@/lib/reporting";
import { reportToCsv } from "@/lib/reporting/export-csv";
import { reportToPdf } from "@/lib/reporting/export-pdf";
import { reportToXlsx } from "@/lib/reporting/export-xlsx";

// Accountant year-end package: one ZIP holding every receipt file, the expense
// index as CSV and XLSX, the PDF summary, and a README. Receipt files are read
// from disk one at a time while the ZIP streams to the client, so a large year
// never sits in memory. yazl writes ZIP64 records when the archive passes 4 GB.

export type PackageReceipt = {
  expenseId: string;
  absolutePath: string;
  packagePath: string;
};

export type PackagePlan = {
  report: AccountantReport;
  receipts: PackageReceipt[];
  missing: Array<{ expenseId: string; packagePath: string; storedPath: string }>;
};

const MISSING_FILE_LABEL = "(file missing)";

function slug(value: string | null | undefined, maxLength: number) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase()
    .slice(0, maxLength);
}

/**
 * Name a receipt inside the ZIP so an accountant can find it without the
 * index: date, vendor, amount, and the first 8 characters of the expense id,
 * which keeps names unique when two receipts share a date, vendor and amount.
 */
export function receiptPackagePath(expense: AccountantReport["expenses"][number]) {
  const date = expense.invoiceDate.toISOString().slice(0, 10);
  const vendor = slug(expense.vendor, 40) || slug(expense.categoryName, 40) || "receipt";
  const amount = fromCents(expense.amountCents).toFixed(2);
  const shortId = expense.id.replaceAll("-", "").slice(0, 8);
  const extension = path.extname(expense.filePath).toLowerCase();
  return `receipts/${date}_${vendor}_${amount}_${shortId}${extension}`;
}

async function isReadableFile(absolutePath: string) {
  try {
    return (await stat(absolutePath)).isFile();
  } catch {
    return false;
  }
}

/**
 * Decide what goes in the ZIP. The returned report has each expense's
 * filePath replaced by its path inside the package, so the index CSV, XLSX
 * and PDF point at the file next to them. Expenses whose stored file is gone
 * stay in the index, marked "(file missing)", and are listed in the README.
 */
export async function planAccountantPackage(
  report: AccountantReport,
  fileExists: (absolutePath: string) => Promise<boolean> = isReadableFile,
): Promise<PackagePlan> {
  const receipts: PackagePlan["receipts"] = [];
  const missing: PackagePlan["missing"] = [];
  const expenses: AccountantReport["expenses"] = [];

  for (const expense of report.expenses) {
    const absolutePath = getStoredExpenseAbsolutePath(expense.filePath);
    const packagePath = receiptPackagePath(expense);
    if (await fileExists(absolutePath)) {
      receipts.push({ expenseId: expense.id, absolutePath, packagePath });
      expenses.push({ ...expense, filePath: packagePath });
    } else {
      missing.push({ expenseId: expense.id, packagePath, storedPath: expense.filePath });
      expenses.push({ ...expense, filePath: MISSING_FILE_LABEL });
    }
  }

  return { report: { ...report, expenses }, receipts, missing };
}

export function packageReadme(plan: PackagePlan) {
  const { report } = plan;
  const from = report.range.from.toISOString().slice(0, 10);
  const to = report.range.to.toISOString().slice(0, 10);
  const lines = [
    `MyFamilyExpenses accountant package`,
    ``,
    `Household: ${report.household.name}`,
    `Invoice dates: ${from} to ${to}`,
    `Generated at: ${report.generatedAt.toISOString()}`,
    `Expenses: ${report.totals.count}`,
    `Total (tax included): ${fromCents(report.totals.totalCents).toFixed(2)}`,
    `Receipt files included: ${plan.receipts.length}`,
    `Receipt files missing: ${plan.missing.length}`,
    ``,
    `Contents`,
    `  summary.pdf   Totals, breakdowns and the expense register`,
    `  index.csv     Every expense; "Receipt reference" is the file in receipts/`,
    `  index.xlsx    The same index as a spreadsheet`,
    `  receipts/     One file per expense: date_vendor_amount_id`,
  ];
  if (plan.missing.length > 0) {
    lines.push(``, `Missing receipt files (the expense is in the index, the file could not be read)`);
    for (const item of plan.missing) {
      lines.push(`  ${item.packagePath}  (expense ${item.expenseId})`);
    }
  }
  return lines.join("\r\n") + "\r\n";
}

/**
 * Build the ZIP as a Node stream. The index and summary are generated up
 * front (they hold row data, not files); receipt files are streamed by yazl
 * one after another. Receipts are stored without compression because JPEG,
 * PNG, WebP and PDF are already compressed.
 */
export async function accountantPackageStream(plan: PackagePlan): Promise<Readable> {
  const zip = new ZipFile();
  const mtime = plan.report.generatedAt;

  zip.addBuffer(Buffer.from(packageReadme(plan), "utf8"), "README.txt", { mtime });
  zip.addBuffer(await reportToPdf(plan.report), "summary.pdf", { mtime });
  zip.addBuffer(Buffer.from(reportToCsv(plan.report), "utf8"), "index.csv", { mtime });
  zip.addBuffer(reportToXlsx(plan.report), "index.xlsx", { mtime });
  for (const receipt of plan.receipts) {
    zip.addFile(receipt.absolutePath, receipt.packagePath, { compress: false });
  }
  zip.end();

  const output = zip.outputStream as Readable;
  // A receipt deleted after planning makes yazl emit "error" on the ZipFile,
  // not on its output. Forward it so the download fails instead of hanging.
  zip.on("error", (error: Error) => output.destroy(error));
  return output;
}
