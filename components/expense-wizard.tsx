"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { OcrResult } from "@/lib/ocr/types";
import { hasAnyOcrField, hasStrongOcrMatch } from "@/lib/ocr/ocr-parsing";

// ── Types ──────────────────────────────────────────────────────────────────────

type CategoryOption = {
  id: string;
  name: string;
};

type Step = "category" | "upload" | "review";

type ExtractResponse = {
  data?: { extraction?: OcrResult };
  error?: { message?: string };
};

type SaveResponse = {
  data?: {
    expense?: {
      id?: string;
      invoiceNumber?: string;
      amount?: unknown;
      invoiceDate?: string;
      category?: { name?: string };
    };
  };
  error?: { message?: string };
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function applyOcrValue(value: string, confidence: number) {
  return confidence > 0 ? value : "";
}

function applyOcrAmount(extraction: OcrResult) {
  return extraction.confidence.amount > 0 ? String(extraction.amount) : "";
}

function getMissingFieldNames(result: OcrResult): string[] {
  const missing: string[] = [];
  if (result.confidence.invoiceNumber === 0) missing.push("invoice number");
  if (result.confidence.invoiceDate === 0) missing.push("date");
  if (result.confidence.amount === 0) missing.push("amount");
  return missing;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

type OcrFieldRowProps = {
  id: string;
  label: string;
  confidence: number;
  hasOcr: boolean;
  value: string;
  onChange: (v: string) => void;
  type: "text" | "date" | "number";
  placeholder?: string;
};

function OcrFieldRow({
  id,
  label,
  confidence,
  hasOcr,
  value,
  onChange,
  type,
  placeholder,
}: OcrFieldRowProps) {
  const isHigh = confidence >= 0.7;
  const isMedium = confidence >= 0.4 && confidence < 0.7;
  const isLow = confidence > 0 && confidence < 0.4;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className="text-sm font-semibold text-slate-700" htmlFor={id}>
          {label}
        </label>

        {isHigh && (
          <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                d="M5 13l4 4L19 7"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
              />
            </svg>
            Auto-filled
          </span>
        )}

        {(isMedium || isLow) && (
          <span className="flex flex-shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
              />
            </svg>
            {isMedium ? "Estimated" : "Low confidence"}
          </span>
        )}

        {hasOcr && confidence === 0 && (
          <span className="flex-shrink-0 text-xs text-slate-400">Not detected</span>
        )}
      </div>

      <div className="relative">
        <input
          className={`w-full rounded-2xl border px-4 py-4 text-slate-900 outline-none transition ${
            isHigh
              ? "border-emerald-300 bg-emerald-50 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              : isMedium
                ? "border-amber-300 bg-amber-50 focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                : isLow
                  ? "border-amber-200 bg-amber-50/60 focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                  : "border-slate-300 bg-white focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          }`}
          id={id}
          inputMode={type === "number" ? "decimal" : undefined}
          min={type === "number" ? "0" : undefined}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          step={type === "number" ? "0.01" : undefined}
          type={type}
          value={value}
        />

        {value !== "" && (
          <button
            aria-label={`Clear ${label}`}
            className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            onClick={() => onChange("")}
            type="button"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                d="M6 18L18 6M6 6l12 12"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Step indicator ─────────────────────────────────────────────────────────────

const STEP_ORDER: Step[] = ["category", "upload", "review"];
const STEP_LABELS: Record<Step, string> = {
  category: "Category",
  upload: "Receipt",
  review: "Review",
};

function StepIndicator({ current }: { current: Step }) {
  const currentIndex = STEP_ORDER.indexOf(current);

  return (
    <div className="flex items-center justify-center gap-1 pb-2">
      {STEP_ORDER.map((step, index) => {
        const done = index < currentIndex;
        const active = step === current;

        return (
          <div className="flex items-center gap-1" key={step}>
            <div className="flex flex-col items-center gap-1">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold transition-colors ${
                  done
                    ? "bg-brand-600 text-white"
                    : active
                      ? "bg-brand-600 text-white ring-4 ring-brand-100"
                      : "bg-slate-100 text-slate-400"
                }`}
              >
                {done ? (
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M5 13l4 4L19 7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                    />
                  </svg>
                ) : (
                  index + 1
                )}
              </div>
              <span
                className={`text-xs font-medium ${
                  active ? "text-brand-700" : done ? "text-brand-600" : "text-slate-400"
                }`}
              >
                {STEP_LABELS[step]}
              </span>
            </div>

            {index < STEP_ORDER.length - 1 ? (
              <div
                className={`mb-4 h-px w-10 transition-colors ${
                  done ? "bg-brand-500" : "bg-slate-200"
                }`}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ExpenseWizard({ categories }: { categories: CategoryOption[] }) {
  const router = useRouter();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("category");
  const [category, setCategory] = useState<CategoryOption | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<OcrResult | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [amount, setAmount] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [ocrWarning, setOcrWarning] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedExpense, setSavedExpense] = useState<{
    id?: string;
    invoiceNumber?: string;
    amount?: string;
    invoiceDate?: string;
    categoryName?: string;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const replacePreviewUrl = (nextUrl: string | null) => {
    setPreviewUrl((current) => {
      if (current?.startsWith("blob:")) URL.revokeObjectURL(current);
      return nextUrl;
    });
  };

  const clearInputElements = () => {
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const clearSelectedFile = () => {
    setFile(null);
    setExtracted(null);
    setInvoiceNumber("");
    setInvoiceDate("");
    setAmount("");
    replacePreviewUrl(null);
    clearInputElements();
  };

  const goToStep = (nextStep: Step) => {
    if (nextStep === "upload" && !category) { setStep("category"); return; }
    if (nextStep === "review") {
      if (!category) { setStep("category"); return; }
      if (!file) { setStep("upload"); return; }
    }
    setStep(nextStep);
  };

  const handleFileSelected = async (selectedFile: File) => {
    if (!category) {
      setOcrWarning("Select a category before scanning or uploading.");
      goToStep("category");
      return;
    }

    clearSelectedFile();
    setOcrWarning(null);
    setSaveError(null);
    setFile(selectedFile);
    replacePreviewUrl(
      selectedFile.type.startsWith("image/") ? URL.createObjectURL(selectedFile) : null,
    );

    setIsExtracting(true);

    try {
      const fd = new FormData();
      fd.append("categoryId", category.id);
      fd.append("file", selectedFile);

      const res = await fetch("/api/expenses/extract", { method: "POST", body: fd });
      const payload = (await res.json().catch(() => null)) as ExtractResponse | null;

      if (!res.ok) {
        setOcrWarning(
          payload?.error?.message ??
            "Could not read this receipt automatically. Fill in the fields below to continue.",
        );
        return;
      }

      const extraction = payload?.data?.extraction;

      if (!extraction || !hasAnyOcrField(extraction)) {
        setOcrWarning(
          "Could not read this receipt automatically. Fill in the fields below to continue.",
        );
        return;
      }

      setExtracted(extraction);
      setInvoiceNumber(applyOcrValue(extraction.invoiceNumber, extraction.confidence.invoiceNumber));
      setInvoiceDate(applyOcrValue(extraction.invoiceDate, extraction.confidence.invoiceDate));
      setAmount(applyOcrAmount(extraction));
    } catch {
      setOcrWarning(
        "Could not read this receipt automatically. Fill in the fields below to continue.",
      );
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSave = async () => {
    if (!category || !file || isExtracting) return;

    setIsSaving(true);
    setSaveError(null);

    const fd = new FormData();
    fd.append("categoryId", category.id);
    fd.append("file", file);
    if (invoiceNumber) fd.append("invoiceNumber", invoiceNumber);
    if (invoiceDate) fd.append("invoiceDate", invoiceDate);
    if (amount) fd.append("amount", amount);

    try {
      const res = await fetch("/api/expenses", { method: "POST", body: fd });
      const payload = (await res.json().catch(() => null)) as SaveResponse | null;

      if (!res.ok) {
        setSaveError(payload?.error?.message ?? "Unable to save expense.");
        return;
      }

      const expense = payload?.data?.expense;
      setSavedExpense({
        id: expense?.id,
        invoiceNumber: expense?.invoiceNumber ?? invoiceNumber,
        amount: amount || String(expense?.amount ?? ""),
        invoiceDate: expense?.invoiceDate
          ? String(expense.invoiceDate).slice(0, 10)
          : invoiceDate,
        categoryName: expense?.category?.name ?? category.name,
      });
      router.refresh();
    } catch {
      setSaveError("Network error. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const reset = () => {
    setStep("category");
    setCategory(null);
    clearSelectedFile();
    setIsExtracting(false);
    setIsSaving(false);
    setOcrWarning(null);
    setSaveError(null);
    setSavedExpense(null);
  };

  // ── Success screen ───────────────────────────────────────────────────────────

  if (savedExpense) {
    const displayAmount =
      savedExpense.amount && savedExpense.amount !== ""
        ? new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(
            parseFloat(savedExpense.amount),
          )
        : null;

    return (
      <div className="rounded-3xl bg-white p-6 shadow-soft">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <svg
              className="h-8 w-8 text-emerald-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M5 13l4 4L19 7"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
              />
            </svg>
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">Saved!</h2>
            <p className="mt-1 text-sm text-slate-500">Your expense has been recorded.</p>
          </div>
        </div>

        <div className="mb-5 rounded-2xl bg-slate-50 p-4">
          {displayAmount && (
            <p className="mb-3 text-center text-3xl font-bold text-slate-900">
              {displayAmount}
            </p>
          )}
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Invoice</dt>
              <dd className="font-medium text-slate-900">{savedExpense.invoiceNumber}</dd>
            </div>
            {savedExpense.categoryName ? (
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Category</dt>
                <dd className="font-medium text-slate-900">{savedExpense.categoryName}</dd>
              </div>
            ) : null}
            {savedExpense.invoiceDate ? (
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Date</dt>
                <dd className="font-medium text-slate-900">{savedExpense.invoiceDate}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        <div className="space-y-3">
          {savedExpense.id ? (
            <button
              className="w-full rounded-2xl border border-slate-200 px-4 py-3.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              onClick={() => router.push(`/expenses/${savedExpense.id}`)}
              type="button"
            >
              View expense details
            </button>
          ) : null}
          <button
            className="w-full rounded-2xl bg-brand-600 px-4 py-4 text-base font-semibold text-white transition hover:bg-brand-700 active:scale-95"
            onClick={reset}
            type="button"
          >
            Add another expense
          </button>
        </div>
      </div>
    );
  }

  // ── Wizard steps ─────────────────────────────────────────────────────────────

  return (
    <div className="rounded-3xl bg-white p-6 shadow-soft">
      <StepIndicator current={step} />

      <div className="mt-6 space-y-5">

        {/* ── Step 1: Category ────────────────────────────────────────────────── */}
        {step === "category" ? (
          <>
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Select a category</h2>
              <p className="mt-1 text-sm text-slate-500">
                Choose what this expense is for before you scan or upload a receipt.
              </p>
            </div>

            {categories.length === 0 ? (
              <p className="rounded-2xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                No categories available. Ask an admin to add some.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {categories.map((currentCategory) => (
                  <button
                    className="group flex flex-col items-start gap-3 rounded-2xl border-2 border-slate-200 p-4 text-left transition hover:border-brand-500 hover:bg-brand-50 active:scale-95"
                    key={currentCategory.id}
                    onClick={() => {
                      setCategory(currentCategory);
                      setOcrWarning(null);
                      goToStep("upload");
                    }}
                    type="button"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 transition group-hover:bg-brand-100">
                      <svg
                        className="h-5 w-5 text-slate-500 transition group-hover:text-brand-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                        />
                      </svg>
                    </div>
                    <span className="text-sm font-semibold text-slate-900">
                      {currentCategory.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : null}

        {/* ── Step 2: Upload ──────────────────────────────────────────────────── */}
        {step === "upload" ? (
          <>
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Upload your receipt</h2>
              <p className="mt-1 text-sm text-slate-500">
                Category:{" "}
                <span className="font-semibold text-brand-700">{category?.name}</span>
              </p>
            </div>

            <input
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(event) => {
                const selectedFile = event.target.files?.[0];
                event.currentTarget.value = "";
                if (selectedFile) void handleFileSelected(selectedFile);
              }}
              ref={cameraInputRef}
              type="file"
            />
            <input
              accept="application/pdf,image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                const selectedFile = event.target.files?.[0];
                event.currentTarget.value = "";
                if (selectedFile) void handleFileSelected(selectedFile);
              }}
              ref={fileInputRef}
              type="file"
            />

            {!file ? (
              <div className="space-y-3">
                <button
                  className="flex w-full items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-brand-400 bg-brand-50 px-4 py-7 text-brand-700 transition hover:bg-brand-100 active:scale-95"
                  onClick={() => cameraInputRef.current?.click()}
                  type="button"
                >
                  <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                    />
                    <path
                      d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                    />
                  </svg>
                  <span className="text-base font-semibold">Take a photo</span>
                </button>

                <button
                  className="flex w-full items-center justify-center gap-3 rounded-2xl border-2 border-slate-200 bg-white px-4 py-5 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 active:scale-95"
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  <svg
                    className="h-6 w-6 text-slate-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                    />
                  </svg>
                  <span className="text-base font-semibold">Choose from files</span>
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                  {previewUrl ? (
                    <Image
                      alt="Receipt preview"
                      className="max-h-52 w-full object-contain"
                      height={800}
                      src={previewUrl}
                      unoptimized
                      width={600}
                    />
                  ) : (
                    <div className="flex items-center gap-3 px-4 py-6">
                      <svg
                        className="h-8 w-8 flex-shrink-0 text-slate-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                        />
                      </svg>
                      <span className="truncate text-sm text-slate-600">{file.name}</span>
                    </div>
                  )}
                </div>

                {isExtracting ? (
                  <p className="animate-pulse text-center text-sm text-slate-500">
                    Reading receipt...
                  </p>
                ) : extracted ? (
                  <p className="text-center text-sm text-emerald-700">
                    {hasStrongOcrMatch(extracted)
                      ? "Receipt read successfully — review the details on the next step."
                      : "Receipt partially read — check the highlighted fields on the next step."}
                  </p>
                ) : ocrWarning ? (
                  <p className="text-center text-sm text-amber-700">{ocrWarning}</p>
                ) : null}

                <button
                  className="text-sm text-slate-400 underline hover:text-slate-600"
                  onClick={clearSelectedFile}
                  type="button"
                >
                  Change file
                </button>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                onClick={() => goToStep("category")}
                type="button"
              >
                Back
              </button>
              <button
                className="flex-1 rounded-2xl bg-brand-600 px-4 py-3 text-base font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 active:scale-95"
                disabled={!file || isExtracting}
                onClick={() => goToStep("review")}
                type="button"
              >
                {isExtracting ? "Reading..." : "Next"}
              </button>
            </div>
          </>
        ) : null}

        {/* ── Step 3: Review ──────────────────────────────────────────────────── */}
        {step === "review" ? (
          <>
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Review and save</h2>
              <p className="mt-1 text-sm text-slate-500">
                Check these details before saving.
              </p>
            </div>

            {/* Context pills */}
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-brand-100 px-3 py-1 text-sm font-medium text-brand-700">
                {category?.name}
              </span>
              <span className="max-w-[220px] truncate rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                {file?.name}
              </span>
            </div>

            {/* OCR status banner */}
            {extracted ? (
              hasStrongOcrMatch(extracted) ? (
                <div className="flex items-start gap-3 rounded-2xl bg-emerald-50 px-4 py-3">
                  <svg
                    className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                    />
                  </svg>
                  <div>
                    <p className="text-sm font-semibold text-emerald-800">
                      All fields auto-detected
                    </p>
                    <p className="mt-0.5 text-xs text-emerald-700">
                      Review the values below, then save.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 rounded-2xl bg-amber-50 px-4 py-3">
                  <svg
                    className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                    />
                  </svg>
                  <div>
                    <p className="text-sm font-semibold text-amber-800">
                      Some fields need attention
                    </p>
                    {getMissingFieldNames(extracted).length > 0 ? (
                      <p className="mt-0.5 text-xs text-amber-700">
                        {getMissingFieldNames(extracted).join(", ")}{" "}
                        {getMissingFieldNames(extracted).length > 1 ? "were" : "was"} not detected
                        — fill{" "}
                        {getMissingFieldNames(extracted).length > 1 ? "them" : "it"} in below.
                      </p>
                    ) : (
                      <p className="mt-0.5 text-xs text-amber-700">
                        Some values have low confidence — verify them before saving.
                      </p>
                    )}
                  </div>
                </div>
              )
            ) : (
              <div className="flex items-start gap-3 rounded-2xl bg-slate-100 px-4 py-3">
                <svg
                  className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                  />
                </svg>
                <p className="text-sm text-slate-600">
                  {ocrWarning ??
                    "Receipt scan unavailable — fill in the fields below to save."}
                </p>
              </div>
            )}

            {/* Compact receipt preview */}
            {previewUrl ? (
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <Image
                  alt="Receipt"
                  className="max-h-36 w-full object-contain bg-slate-50"
                  height={800}
                  src={previewUrl}
                  unoptimized
                  width={600}
                />
              </div>
            ) : null}

            {/* Fields with confidence indicators */}
            <div className="space-y-4">
              <OcrFieldRow
                confidence={extracted?.confidence.invoiceNumber ?? 0}
                hasOcr={!!extracted}
                id="invoiceNumber"
                label="Invoice number"
                onChange={setInvoiceNumber}
                placeholder="e.g. INV-2026-001"
                type="text"
                value={invoiceNumber}
              />
              <OcrFieldRow
                confidence={extracted?.confidence.invoiceDate ?? 0}
                hasOcr={!!extracted}
                id="invoiceDate"
                label="Invoice date"
                onChange={setInvoiceDate}
                type="date"
                value={invoiceDate}
              />
              <OcrFieldRow
                confidence={extracted?.confidence.amount ?? 0}
                hasOcr={!!extracted}
                id="reviewAmount"
                label="Amount"
                onChange={setAmount}
                placeholder="0.00"
                type="number"
                value={amount}
              />
            </div>

            {/* Save error */}
            {saveError ? (
              <div className="flex items-start gap-3 rounded-2xl bg-rose-50 px-4 py-3">
                <svg
                  className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                  />
                </svg>
                <p className="text-sm text-rose-700">{saveError}</p>
              </div>
            ) : null}

            <div className="flex gap-3 pt-2">
              <button
                className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                disabled={isSaving}
                onClick={() => goToStep("upload")}
                type="button"
              >
                Back
              </button>
              <button
                className="flex-1 rounded-2xl bg-brand-600 px-4 py-4 text-base font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 active:scale-95"
                disabled={isSaving || isExtracting}
                onClick={() => void handleSave()}
                type="button"
              >
                {isSaving ? "Saving..." : "Save expense"}
              </button>
            </div>
          </>
        ) : null}

      </div>
    </div>
  );
}
