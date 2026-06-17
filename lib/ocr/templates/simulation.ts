import type {
  OcrAmountCandidate,
  OcrCandidates,
  OcrConfidence,
  ReceiptType,
  SimulationDecision,
  TemplateSimulationResult,
} from "@/lib/ocr/types";
import type { AmountRules, MerchantTemplate } from "./types";
import { MERCHANT_TEMPLATES } from "./merchant-templates";

// Phase D.3A: static template SIMULATION (dry-run). Pure and diagnostic. Runs
// only CODE-REVIEWED static templates (never database-derived drafts) against a
// parser result and reports what a template WOULD do — it changes nothing,
// persists nothing, and is never returned to end users. It deliberately imports
// only the static template registry, never drafts/recommendations/feedback.

// Confidence bands for the decision tree. A template must never override a
// high-confidence parser total (wrong amount is worse than blank).
export const STRONG_AMOUNT_CONFIDENCE = 0.85;
export const MODERATE_AMOUNT_CONFIDENCE = 0.6;

export type TemplateMode = "off" | "simulate" | "apply";

/**
 * Resolve the template mode from env. Defaults: never "apply" by default; "off"
 * in production, "simulate" elsewhere. The literal mode is returned (apply is NOT
 * clamped here) — whether application actually takes effect is decided separately
 * by `resolveApplicationGate` (which enforces the production second-guard). The
 * mode only controls whether the dry-run simulation RUNS; simulation in apply mode
 * is still purely diagnostic.
 */
export function resolveTemplateMode(): TemplateMode {
  const raw = (process.env.OCR_TEMPLATE_MODE ?? "").toLowerCase();
  if (raw === "off" || raw === "simulate" || raw === "apply") {
    return raw;
  }
  return process.env.NODE_ENV === "production" ? "off" : "simulate";
}

export const shouldRunTemplateSimulation = () => resolveTemplateMode() !== "off";

export type SimulationInput = {
  merchantGuess: string | null;
  receiptType: ReceiptType;
  // Transient — used only for pattern matching. NEVER stored, logged, or returned.
  rawText?: string;
  candidates: OcrCandidates;
  parser: {
    invoiceNumber: string;
    invoiceDate: string;
    amount: number;
    confidence: OcrConfidence;
  };
  meta?: { provider?: string; strategy?: string };
};

const norm = (value: string) => value.toLowerCase();
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const centsEqual = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

function labelMatches(sourceLabel: string, labels: string[]): boolean {
  const s = norm(sourceLabel);
  return labels.some((label) => s.includes(norm(label)));
}

function matchTemplate(input: SimulationInput): MerchantTemplate | null {
  const haystacks = [input.merchantGuess ?? "", input.rawText ?? ""].filter(Boolean);
  for (const template of MERCHANT_TEMPLATES) {
    const typeOk =
      template.receiptType === "any" || template.receiptType === input.receiptType;
    if (!typeOk) continue;
    if (!haystacks.some((h) => template.merchantPattern.test(h))) continue;
    const negative = (template.negativePatterns ?? []).some((p) =>
      haystacks.some((h) => h.toLowerCase().includes(p.toLowerCase())),
    );
    if (negative) continue;
    return template;
  }
  return null;
}

// Pick the best amount candidate that a template would prefer: highest-ranked
// candidate whose sourceLabel matches a preferred label and is NOT in the avoided
// labels (subtotal/tax/change/balance/tip). Returns null when none qualifies.
function pickTemplateAmount(
  amounts: OcrAmountCandidate[],
  rules: AmountRules,
): OcrAmountCandidate | null {
  const prefer = rules.preferLabels ?? [];
  const avoid = rules.avoidLabels ?? [];
  const safe = amounts.filter((c) => !labelMatches(c.sourceLabel ?? "", avoid));
  const preferred = safe.filter((c) => labelMatches(c.sourceLabel ?? "", prefer));
  return preferred[0] ?? null;
}

const emptyResult = (
  decision: SimulationDecision,
  reasons: string[],
  warnings: string[] = [],
): TemplateSimulationResult => ({
  matchedTemplateId: null,
  templateName: null,
  suggestedAmount: null,
  suggestedAmountConfidence: null,
  suggestedDate: null,
  suggestedInvoice: null,
  confidenceDelta: 0,
  warnings,
  decision,
  reasons,
});

/**
 * Run static-template simulation against a parser result. Pure, diagnostic. The
 * returned `reasons`/`warnings` carry only template ids, candidate source labels
 * (e.g. "Total"), amounts, and the decision — never raw OCR text or invoice/
 * reference strings.
 */
export function simulateTemplates(input: SimulationInput): TemplateSimulationResult {
  const template = matchTemplate(input);
  if (!template) {
    return emptyResult("no_match", ["No static template matched the merchant/receipt type."]);
  }

  const reasons = [`Matched static template "${template.id}".`];
  const warnings: string[] = [];
  const picked = pickTemplateAmount(input.candidates.amount ?? [], template.amountRules);

  let decision: SimulationDecision = "same_as_parser";
  let suggestedAmount: number | null = null;
  let confidenceDelta = 0;

  if (!picked) {
    reasons.push("No preferred-label amount candidate available; nothing to suggest.");
  } else {
    confidenceDelta = round4((picked.confidence ?? 0) - (input.parser.confidence.amount ?? 0));
    reasons.push(`Preferred label "${picked.sourceLabel}" → amount ${picked.value}.`);

    if (centsEqual(picked.value, input.parser.amount)) {
      reasons.push("Template amount equals the parser amount.");
    } else {
      suggestedAmount = picked.value;
      const conf = input.parser.confidence.amount ?? 0;
      reasons.push(
        `Differs from parser amount ${input.parser.amount} (parser confidence ${conf}).`,
      );
      if (conf >= STRONG_AMOUNT_CONFIDENCE) {
        decision = "unsafe";
        warnings.push(
          "Template would override a high-confidence parser total — wrong amount is worse than blank.",
        );
      } else if (conf >= MODERATE_AMOUNT_CONFIDENCE) {
        decision = "would_conflict";
        warnings.push("Template disagrees with a moderately confident parser amount; human review needed.");
      } else {
        decision = "would_improve";
      }
    }
  }

  if (template.invoiceRules.optional && input.parser.invoiceNumber.trim() === "") {
    reasons.push("Template treats invoice/reference as optional; a generated label is acceptable.");
  }

  return {
    matchedTemplateId: template.id,
    templateName: template.id,
    suggestedAmount,
    suggestedAmountConfidence: picked ? round4(picked.confidence ?? 0) : null,
    suggestedDate: null, // D.3A defers date handling to the parser
    suggestedInvoice: null, // never fabricated
    confidenceDelta,
    warnings,
    decision,
    reasons,
  };
}
