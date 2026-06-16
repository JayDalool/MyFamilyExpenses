import type { MerchantTemplate } from "./types";
import { MERCHANT_TEMPLATES } from "./merchant-templates";

export type {
  MerchantTemplate,
  AmountRules,
  DateRules,
  InvoiceRules,
  ConfidenceBoost,
  TemplateField,
} from "./types";
export { MERCHANT_TEMPLATES, GENERIC_CASH_RECEIPT_TEMPLATE } from "./merchant-templates";
export {
  buildTemplateRecommendations,
  type TemplateRecommendation,
  type RecommendationKind,
  type RecommendationSeverity,
} from "./recommendations";

/**
 * Read-only lookup of a template for a merchant string. This is INERT — it is NOT
 * called from the OCR parser or service. It exists for future, human-reviewed
 * wiring and for tests. Returns the first matching template, or null.
 */
export function findMerchantTemplate(
  merchant: string | null | undefined,
): MerchantTemplate | null {
  if (!merchant || merchant.trim() === "") return null;
  for (const template of MERCHANT_TEMPLATES) {
    if (template.merchantPattern.test(merchant)) {
      if (
        template.negativePatterns?.some((pattern) =>
          merchant.toLowerCase().includes(pattern.toLowerCase()),
        )
      ) {
        continue;
      }
      return template;
    }
  }
  return null;
}
