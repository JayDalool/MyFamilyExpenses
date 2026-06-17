import type {
  OcrCandidates,
  OcrResult,
  TemplateApplicationMeta,
  TemplateSimulationResult,
} from "@/lib/ocr/types";
import { resolveTemplateMode, type TemplateMode } from "./simulation";

// Phase D.3B: GUARDED static-template application. Pure. Turns a dry-run
// simulation into an actual change to the user-facing extraction result — but only
// under strict safety rules and only when apply mode is truly enabled. It uses
// ONLY code-reviewed static templates (via the simulation result); it never
// touches database-derived drafts, recommendations, or correction feedback.
//
// Safety stance: a wrong amount is worse than a blank one. Application can only
// FILL a missing/weak field, never override a confident parser value.

// A template amount is only applied when its own candidate confidence is at least
// this high. Below it, we keep the (possibly blank) parser value.
export const APPLY_MIN_AMOUNT_CONFIDENCE = 0.7;
// The parser amount must be at most this confident to be considered weak/missing.
export const WEAK_PARSER_AMOUNT_MAX = 0.6;
// A missing parser date is only filled from a candidate at least this confident.
export const APPLY_MIN_DATE_CONFIDENCE = 0.7;

export type ApplicationGate = {
  mode: TemplateMode;
  apply: boolean;
  blockedReason: string | null;
};

/**
 * Decide whether template application may take effect. apply requires
 * OCR_TEMPLATE_MODE=apply AND, in production, the explicit second guard
 * OCR_TEMPLATE_APPLY_IN_PRODUCTION=true. Default behavior is therefore unchanged
 * unless both are set.
 */
export function resolveApplicationGate(): ApplicationGate {
  const mode = resolveTemplateMode();
  if (mode !== "apply") {
    return { mode, apply: false, blockedReason: null };
  }
  const isProduction = process.env.NODE_ENV === "production";
  const productionGuard = process.env.OCR_TEMPLATE_APPLY_IN_PRODUCTION === "true";
  if (isProduction && !productionGuard) {
    return {
      mode,
      apply: false,
      blockedReason:
        "apply blocked in production without OCR_TEMPLATE_APPLY_IN_PRODUCTION=true",
    };
  }
  return { mode, apply: true, blockedReason: null };
}

export type TemplateApplicationResult = TemplateApplicationMeta & {
  result: OcrResult;
};

type ApplyTemplateArgs = {
  parser: OcrResult;
  simulation: TemplateSimulationResult | null;
  candidates: OcrCandidates;
  gate: ApplicationGate;
};

/**
 * Apply a matched static template's safe suggestions to the parser result. Returns
 * the (possibly cloned) result plus internal metadata. When nothing is applied —
 * including off/simulate mode, a blocked production gate, no match, or any safety
 * failure — `result` is the ORIGINAL parser object by reference, so callers can
 * rely on `response === parserResult` meaning "unchanged".
 */
export function applyTemplate(args: ApplyTemplateArgs): TemplateApplicationResult {
  const { parser, simulation, candidates, gate } = args;

  const unchanged = (
    reasons: string[],
    warnings: string[] = [],
  ): TemplateApplicationResult => ({
    result: parser,
    applied: false,
    appliedTemplateId: null,
    appliedFields: {},
    warnings,
    reasons,
  });

  if (!gate.apply) {
    return unchanged(
      [gate.blockedReason ?? `Template application is not enabled (mode=${gate.mode}).`],
      gate.blockedReason ? [gate.blockedReason] : [],
    );
  }
  if (!simulation || !simulation.matchedTemplateId) {
    return unchanged(["No matched static template to apply."]);
  }

  const reasons: string[] = [];
  const warnings: string[] = [];
  const appliedFields: TemplateApplicationMeta["appliedFields"] = {};
  let next = parser;

  // ── Amount (most sensitive) ─────────────────────────────────────────────────
  // Only FILL a missing/weak parser amount from a high-confidence preferred total.
  // Never override a confident parser amount (unsafe/would_conflict keep parser).
  if (simulation.decision === "would_improve" && simulation.suggestedAmount !== null) {
    const templateConf = simulation.suggestedAmountConfidence ?? 0;
    const parserWeak = parser.confidence.amount < WEAK_PARSER_AMOUNT_MAX;
    if (parserWeak && templateConf >= APPLY_MIN_AMOUNT_CONFIDENCE) {
      next = {
        ...next,
        amount: simulation.suggestedAmount,
        confidence: { ...next.confidence, amount: templateConf },
      };
      appliedFields.amount = true;
      reasons.push(
        `Filled weak parser amount with template total ${simulation.suggestedAmount} ` +
          `(template confidence ${templateConf}).`,
      );
    } else if (!parserWeak) {
      reasons.push("Kept parser amount: parser amount is not weak.");
    } else {
      reasons.push(
        `Kept parser amount: template amount confidence ${templateConf} below ` +
          `${APPLY_MIN_AMOUNT_CONFIDENCE}.`,
      );
    }
  } else if (simulation.decision === "unsafe" || simulation.decision === "would_conflict") {
    reasons.push(
      `Kept parser amount (${simulation.decision}): a template must never override a confident total.`,
    );
  }

  // ── Date (conservative) ─────────────────────────────────────────────────────
  // Only fill a MISSING parser date from a high-confidence parser date candidate
  // (uses existing parser date logic; never a template-invented date).
  if (parser.invoiceDate.trim() === "") {
    const topDate = (candidates.invoiceDate ?? [])[0];
    if (topDate && (topDate.confidence ?? 0) >= APPLY_MIN_DATE_CONFIDENCE) {
      next = {
        ...next,
        invoiceDate: topDate.value,
        confidence: { ...next.confidence, invoiceDate: topDate.confidence },
      };
      appliedFields.date = true;
      reasons.push("Filled missing date from a high-confidence candidate.");
    }
  }

  // ── Invoice/reference ───────────────────────────────────────────────────────
  // Never forced. Generated labels are handled by the save route where supported.
  // (No application; intentionally a no-op.)

  const applied = Boolean(appliedFields.amount || appliedFields.date);
  return {
    result: applied ? next : parser,
    applied,
    appliedTemplateId: applied ? simulation.matchedTemplateId : null,
    appliedFields,
    warnings,
    reasons: reasons.length > 0 ? reasons : ["No safe template change to apply."],
  };
}
