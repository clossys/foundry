/**
 * @clossys/designer/mark — master brand mark contract and coverage gate.
 *
 * Consumers copy `mark-template.tsx`, fill the three SVG-backed React
 * variants, and run `designer-mark-check` in CI. This module is the
 * library surface; the CLI is installed as `designer-mark-check`.
 */

export {
  BRAND_LOCKUP_EXPORT,
  BRAND_LOCKUP_INVERSE_EXPORT,
  BRAND_MARK_EXPORTS,
  BRAND_MARK_ONLY_EXPORT,
  BRAND_MARK_TEMPLATE_PLACEHOLDER,
  BRAND_WORDMARK_BINDING,
  INVERSE_INK_CLASS,
  INVERSE_SURFACE_CLASS,
  isPlaceholderAuthoredValue,
} from "./brand-mark-contract.js";
export type { BrandMarkExportName } from "./brand-mark-contract.js";

export { checkBrandMark } from "./check-brand-mark.js";
export type { BrandMarkFinding, BrandMarkReport } from "./check-brand-mark.js";
