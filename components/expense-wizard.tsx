"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type CategoryOption = {
  id: string;
  name: string;
};

type ExtractedData = {
  invoiceNumber: string;
  invoiceDate: string;
  amount: number;
};

type Step = "category" | "upload" | "review";

const STEPS: Step[] = ["category", "upload", "review"];
const STEP_LABELS: Record<Step, string> = {
  category: "Category",
  upload: "Receipt",
  review: "Review",
};

function StepIndicator({ current }: { current: Step }) {
  const currentIndex = STEPS.indexOf(current);
  return (
    <div className="flex items-center justify-center gap-1 pb-2">
      {STEPS.map((step, i) => {
        const done = i < currentIndex;
        const active = step === current;
        return (
          <div key={step} className="flex items-center gap-1">
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
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`text-xs font-medium ${active ? "text-brand-700" : done ? "text-brand-600" : "text-slate-400"}`}
              >
                {STEP_LABELS[step]}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`mb-4 h-px w-10 transition-colors ${done ? "bg-brand-500" : "bg-slate-200"}`}
              />
            )}
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
  const [extracted, setExtracted] = useState<ExtractedData | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [amount, setAmount] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedLabel, setSavedLabel] = useState<string | null>(null);

  const handleFileSelected = async (selected: File) => {
    setFile(selected);
    setError(null);
    setPreviewUrl(selected.type.startsWith("image/") ? URL.createObjectURL(selected) : null);

    setIsExtracting(true);
    try {
      const fd = new FormData();
      fd.append("file", selected);
      const res = await fetch("/api/expenses/extract", { method: "POST", body: fd });
      if (res.ok) {
        const json = (await res.json()) as { data?: ExtractedData };
        if (json.data) {
          setExtracted(json.data);
          setInvoiceNumber(json.data.invoiceNumber);
          setInvoiceDate(json.data.invoiceDate);
          setAmount(String(json.data.amount));
        }
      }
    } catch {
      // extraction failed silently; user fills in manually
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSave = async () => {
    if (!category || !file) return;
    setIsSaving(true);
    setError(null);

    const fd = new FormData();
    fd.append("categoryId", category.id);
    fd.append("file", file);
    if (invoiceNumber) fd.append("invoiceNumber", invoiceNumber);
    if (invoiceDate) fd.append("invoiceDate", invoiceDate);
    if (amount) fd.append("amount", amount);

    try {
      const res = await fetch("/api/expenses", { method: "POST", body: fd });
      const data = (await res.json().catch(() => null)) as
        | { data?: { expense?: { invoiceNumber?: string } }; error?: { message?: string } }
        | null;

      if (!res.ok) {
        setError(data?.error?.message ?? "Unable to save expense.");
        return;
      }

      setSavedLabel(data?.data?.expense?.invoiceNumber ?? "Expense");
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
    setFile(null);
    setPreviewUrl(null);
    setExtracted(null);
    setIsExtracting(false);
    setInvoiceNumber("");
    setInvoiceDate("");
    setAmount("");
    setError(null);
    setSavedLabel(null);
  };

  // ── Success screen ─────────────────────────────────────────────────────────
  if (savedLabel) {
    return (
      <div className="rounded-3xl bg-white p-8 shadow-soft text-center space-y-5">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
          <svg className="h-8 w-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Saved!</h2>
          <p className="mt-1 text-slate-500">{savedLabel} has been recorded.</p>
        </div>
        <button
          onClick={reset}
          className="w-full rounded-2xl bg-brand-600 px-4 py-4 text-base font-semibold text-white transition hover:bg-brand-700 active:scale-95"
        >
          Add another expense
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-3xl bg-white p-6 shadow-soft">
      <StepIndicator current={step} />
      <div className="mt-6 space-y-5">

        {/* ── Step 1: Category ──────────────────────────────────────────────── */}
        {step === "category" && (
          <>
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Select a category</h2>
              <p className="mt-1 text-sm text-slate-500">Choose what this expense is for.</p>
            </div>

            {categories.length === 0 ? (
              <p className="rounded-2xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                No categories available. Ask an admin to add some.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => {
                      setCategory(cat);
                      setStep("upload");
                    }}
                    className="group flex flex-col items-start gap-3 rounded-2xl border-2 border-slate-200 p-4 text-left transition hover:border-brand-500 hover:bg-brand-50 active:scale-95"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 transition group-hover:bg-brand-100">
                      <svg
                        className="h-5 w-5 text-slate-500 transition group-hover:text-brand-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                        />
                      </svg>
                    </div>
                    <span className="text-sm font-semibold text-slate-900">{cat.name}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Step 2: Upload ────────────────────────────────────────────────── */}
        {step === "upload" && (
          <>
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Upload your receipt</h2>
              <p className="mt-1 text-sm text-slate-500">
                Category:{" "}
                <span className="font-semibold text-brand-700">{category?.name}</span>
              </p>
            </div>

            {/* Hidden inputs */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFileSelected(f);
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFileSelected(f);
              }}
            />

            {!file ? (
              <div className="space-y-3">
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex w-full items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-brand-400 bg-brand-50 px-4 py-7 text-brand-700 transition hover:bg-brand-100 active:scale-95"
                >
                  <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                    />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="text-base font-semibold">Take a Photo</span>
                </button>

                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full items-center justify-center gap-3 rounded-2xl border-2 border-slate-200 bg-white px-4 py-5 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 active:scale-95"
                >
                  <svg className="h-6 w-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                  <span className="text-base font-semibold">Choose from Files</span>
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                  {previewUrl ? (
                    <Image
                      src={previewUrl}
                      alt="Receipt preview"
                      className="max-h-52 w-full object-contain"
                      height={800}
                      width={600}
                      unoptimized
                    />
                  ) : (
                    <div className="flex items-center gap-3 px-4 py-6">
                      <svg className="h-8 w-8 flex-shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                      <span className="truncate text-sm text-slate-600">{file.name}</span>
                    </div>
                  )}
                </div>

                {isExtracting && (
                  <p className="animate-pulse text-center text-sm text-slate-500">
                    Reading receipt data...
                  </p>
                )}

                <button
                  onClick={() => {
                    setFile(null);
                    setPreviewUrl(null);
                    setExtracted(null);
                    setInvoiceNumber("");
                    setInvoiceDate("");
                    setAmount("");
                  }}
                  className="text-sm text-slate-400 underline hover:text-slate-600"
                >
                  Change file
                </button>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setStep("category")}
                className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                ← Back
              </button>
              <button
                onClick={() => setStep("review")}
                disabled={!file || isExtracting}
                className="flex-1 rounded-2xl bg-brand-600 px-4 py-3 text-base font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 active:scale-95"
              >
                {isExtracting ? "Reading..." : "Next →"}
              </button>
            </div>
          </>
        )}

        {/* ── Step 3: Review ────────────────────────────────────────────────── */}
        {step === "review" && (
          <>
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Review & save</h2>
              <p className="mt-1 text-sm text-slate-500">Edit the details if needed, then save.</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-brand-100 px-3 py-1 text-sm font-medium text-brand-700">
                {category?.name}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">
                {file?.name}
              </span>
              {extracted && (
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                  OCR auto-filled
                </span>
              )}
            </div>

            {previewUrl && (
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <Image
                  src={previewUrl}
                  alt="Receipt"
                  className="max-h-44 w-full object-contain bg-slate-50"
                  height={800}
                  width={600}
                  unoptimized
                />
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label
                  className="mb-1.5 block text-sm font-medium text-slate-700"
                  htmlFor="invoiceNumber"
                >
                  Invoice number
                </label>
                <input
                  id="invoiceNumber"
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="Leave blank to use OCR value"
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-brand-500"
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
                  id="invoiceDate"
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-brand-500"
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
                  id="reviewAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-brand-500"
                />
              </div>
            </div>

            {error && (
              <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setStep("upload")}
                disabled={isSaving}
                className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                ← Back
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={isSaving}
                className="flex-1 rounded-2xl bg-brand-600 px-4 py-4 text-base font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 active:scale-95"
              >
                {isSaving ? "Saving..." : "Save Expense"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
