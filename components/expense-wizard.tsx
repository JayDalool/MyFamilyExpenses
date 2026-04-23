"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { OcrResult } from "@/lib/ocr/types";
import { hasAnyOcrField, hasStrongOcrMatch } from "@/lib/ocr/ocr-parsing";

type CategoryOption = {
  id: string;
  name: string;
};

type Step = "category" | "upload" | "review";

type ExtractResponse = {
  data?: {
    extraction?: OcrResult;
  };
  error?: {
    message?: string;
  };
};

type SaveResponse = {
  data?: {
    expense?: {
      id?: string;
      invoiceNumber?: string;
    };
  };
  error?: {
    message?: string;
  };
};

function applyOcrValue(value: string, confidence: number) {
  return confidence > 0 ? value : "";
}

function applyOcrAmount(extraction: OcrResult) {
  return extraction.confidence.amount > 0 ? String(extraction.amount) : "";
}

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
  const [error, setError] = useState<string | null>(null);
  const [savedExpense, setSavedExpense] = useState<{
    id?: string;
    invoiceNumber?: string;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const replacePreviewUrl = (nextPreviewUrl: string | null) => {
    setPreviewUrl((currentPreviewUrl) => {
      if (currentPreviewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(currentPreviewUrl);
      }

      return nextPreviewUrl;
    });
  };

  const clearInputElements = () => {
    if (cameraInputRef.current) {
      cameraInputRef.current.value = "";
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
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
    if (nextStep === "upload" && !category) {
      setStep("category");
      return;
    }

    if (nextStep === "review") {
      if (!category) {
        setStep("category");
        return;
      }

      if (!file) {
        setStep("upload");
        return;
      }
    }

    setStep(nextStep);
  };

  const handleFileSelected = async (selectedFile: File) => {
    if (!category) {
      setError("Select a category before scanning or uploading.");
      goToStep("category");
      return;
    }

    clearSelectedFile();
    setError(null);
    setFile(selectedFile);
    replacePreviewUrl(
      selectedFile.type.startsWith("image/")
        ? URL.createObjectURL(selectedFile)
        : null,
    );

    setIsExtracting(true);

    try {
      const formData = new FormData();
      formData.append("categoryId", category.id);
      formData.append("file", selectedFile);

      const response = await fetch("/api/expenses/extract", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json().catch(() => null)) as
        | ExtractResponse
        | null;

      if (!response.ok) {
        setError(
          payload?.error?.message ??
            "Could not read this invoice automatically. You can still continue and fill in the fields manually.",
        );
        return;
      }

      const extraction = payload?.data?.extraction;

      if (!extraction) {
        setError(
          "Could not read this invoice automatically. You can still continue and fill in the fields manually.",
        );
        return;
      }

      if (!hasAnyOcrField(extraction)) {
        setError(
          "Could not read this invoice automatically. You can still continue and fill in the fields manually.",
        );
        return;
      }

      setExtracted(extraction);
      setInvoiceNumber(
        applyOcrValue(
          extraction.invoiceNumber,
          extraction.confidence.invoiceNumber,
        ),
      );
      setInvoiceDate(
        applyOcrValue(extraction.invoiceDate, extraction.confidence.invoiceDate),
      );
      setAmount(applyOcrAmount(extraction));
    } catch {
      setError(
        "Could not read this invoice automatically. You can still continue and fill in the fields manually.",
      );
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSave = async () => {
    if (!category || !file || isExtracting) {
      return;
    }

    setIsSaving(true);
    setError(null);

    const formData = new FormData();
    formData.append("categoryId", category.id);
    formData.append("file", file);

    if (invoiceNumber) {
      formData.append("invoiceNumber", invoiceNumber);
    }

    if (invoiceDate) {
      formData.append("invoiceDate", invoiceDate);
    }

    if (amount) {
      formData.append("amount", amount);
    }

    try {
      const response = await fetch("/api/expenses", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json().catch(() => null)) as
        | SaveResponse
        | null;

      if (!response.ok) {
        setError(payload?.error?.message ?? "Unable to save expense.");
        return;
      }

      setSavedExpense(payload?.data?.expense ?? { invoiceNumber: "Expense" });
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
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
    setError(null);
    setSavedExpense(null);
  };

  if (savedExpense) {
    return (
      <div className="space-y-5 rounded-3xl bg-white p-8 text-center shadow-soft">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
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
          <p className="mt-1 text-slate-500">
            {savedExpense.invoiceNumber ?? "Expense"} has been recorded.
          </p>
        </div>

        <div className="space-y-3">
          {savedExpense.id ? (
            <button
              className="w-full rounded-2xl border border-slate-300 px-4 py-4 text-base font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
              onClick={() => router.push(`/expenses/${savedExpense.id}`)}
              type="button"
            >
              View saved expense
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

  return (
    <div className="rounded-3xl bg-white p-6 shadow-soft">
      <StepIndicator current={step} />

      <div className="mt-6 space-y-5">
        {step === "category" ? (
          <>
            <div>
              <h2 className="text-xl font-semibold text-slate-900">
                Select a category
              </h2>
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
                      setError(null);
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

        {step === "upload" ? (
          <>
            <div>
              <h2 className="text-xl font-semibold text-slate-900">
                Upload your receipt
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Category:{" "}
                <span className="font-semibold text-brand-700">
                  {category?.name}
                </span>
              </p>
            </div>

            <input
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(event) => {
                const selectedFile = event.target.files?.[0];
                event.currentTarget.value = "";

                if (selectedFile) {
                  void handleFileSelected(selectedFile);
                }
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

                if (selectedFile) {
                  void handleFileSelected(selectedFile);
                }
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
                  <svg
                    className="h-7 w-7"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
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
                      <span className="truncate text-sm text-slate-600">
                        {file.name}
                      </span>
                    </div>
                  )}
                </div>

                {isExtracting ? (
                  <p className="animate-pulse text-center text-sm text-slate-500">
                    Reading receipt data...
                  </p>
                ) : extracted ? (
                  <p className="text-center text-sm text-emerald-700">
                    {hasStrongOcrMatch(extracted)
                      ? "Receipt details were auto-filled. Review them on the next step."
                      : "Receipt details were partially filled. Review and complete them on the next step."}
                  </p>
                ) : (
                  <p className="text-center text-sm text-slate-500">
                    If auto-read does not work, you can still continue and enter the details manually.
                  </p>
                )}

                <button
                  className="text-sm text-slate-400 underline hover:text-slate-600"
                  onClick={clearSelectedFile}
                  type="button"
                >
                  Change file
                </button>
              </div>
            )}

            {error ? (
              <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </p>
            ) : null}

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

        {step === "review" ? (
          <>
            <div>
              <h2 className="text-xl font-semibold text-slate-900">
                Review and save
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Confirm the extracted values and save when they look right.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-brand-100 px-3 py-1 text-sm font-medium text-brand-700">
                {category?.name}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">
                {file?.name}
              </span>
              {extracted ? (
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                  OCR auto-filled
                </span>
              ) : null}
            </div>

            {previewUrl ? (
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <Image
                  alt="Receipt preview"
                  className="max-h-44 w-full object-contain bg-slate-50"
                  height={800}
                  src={previewUrl}
                  unoptimized
                  width={600}
                />
              </div>
            ) : null}

            <div className="space-y-3">
              <div>
                <label
                  className="mb-1.5 block text-sm font-medium text-slate-700"
                  htmlFor="invoiceNumber"
                >
                  Invoice number
                </label>
                <input
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-brand-500"
                  id="invoiceNumber"
                  onChange={(event) => setInvoiceNumber(event.target.value)}
                  placeholder="Enter the invoice number"
                  type="text"
                  value={invoiceNumber}
                />
              </div>

              <div>
                <label
                  className="mb-1.5 block text-sm font-medium text-slate-700"
                  htmlFor="invoiceDate"
                >
                  Invoice date
                </label>
                <input
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-brand-500"
                  id="invoiceDate"
                  onChange={(event) => setInvoiceDate(event.target.value)}
                  type="date"
                  value={invoiceDate}
                />
              </div>

              <div>
                <label
                  className="mb-1.5 block text-sm font-medium text-slate-700"
                  htmlFor="reviewAmount"
                >
                  Amount
                </label>
                <input
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-brand-500"
                  id="reviewAmount"
                  min="0"
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  type="number"
                  value={amount}
                />
              </div>
            </div>

            {error ? (
              <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </p>
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
