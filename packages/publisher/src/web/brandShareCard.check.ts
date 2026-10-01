/**
 * Compile-time-only assertions about `BrandShareCardInput`. Named `.check.ts`
 * rather than `.test.ts` on purpose: this package's tsconfig excludes test
 * files from the real `tsc` run, so a type-level guarantee inside one asserts
 * nothing. Nothing imports this file at runtime.
 */
import type { BrandShareCardInput } from "./shareCard.js";

// `alt` is optional: the brand card derives it from its visible text.
export const withoutAlt: BrandShareCardInput = { markSrc: "data:image/svg+xml,<svg/>", headline: "Sign in" };
