/**
 * Pure brand-mark gate — given the text of a consumer's filled copy of
 * `templates/mark-template.tsx`, reports when a real lockup was authored
 * but a required sibling variant (mark-only or inverse lockup) is missing
 * or still a template stub.
 */

import {
  BRAND_LOCKUP_EXPORT,
  BRAND_LOCKUP_INVERSE_EXPORT,
  BRAND_MARK_ONLY_EXPORT,
  BRAND_WORDMARK_BINDING,
  INVERSE_INK_CLASS,
  INVERSE_SURFACE_CLASS,
  isPlaceholderAuthoredValue,
} from "./brand-mark-contract.js";

export interface BrandMarkFinding {
  rule: string;
  message: string;
}

export interface BrandMarkReport {
  path: string;
  lockupAuthored: boolean;
  findings: BrandMarkFinding[];
}

const EXPORT_FN_RE = /export\s+function\s+([A-Za-z0-9_]+)\s*\(/g;
const WORDMARK_BINDING_RE = /export\s+const\s+BRAND_WORDMARK\s*=\s*(["'`])([\s\S]*?)\1\s*;/;

function exportedFunctions(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(EXPORT_FN_RE)) {
    names.add(match[1] as string);
  }
  return names;
}

function readWordmarkBinding(source: string): string | undefined {
  const match = source.match(WORDMARK_BINDING_RE);
  return match?.[2];
}

function exportSection(source: string, exportName: string): string | undefined {
  const marker = `export function ${exportName}`;
  const start = source.indexOf(marker);
  if (start === -1) return undefined;
  const nextExport = source.indexOf("export function", start + marker.length);
  return nextExport === -1 ? source.slice(start) : source.slice(start, nextExport);
}

function inverseVariantSatisfied(source: string, exports: Set<string>): boolean {
  if (!exports.has(BRAND_LOCKUP_INVERSE_EXPORT)) return false;
  const section = exportSection(source, BRAND_LOCKUP_INVERSE_EXPORT);
  if (!section) return false;
  return section.includes(INVERSE_SURFACE_CLASS) && section.includes(INVERSE_INK_CLASS);
}

/**
 * Classify a consumer mark module. When `BRAND_WORDMARK` is still the
 * template placeholder, the brand has not committed to a lockup yet and
 * this gate reports no findings. Once the wordmark is authored, all three
 * variant exports must be present and the inverse export must paint inverse
 * surface + ink tokens.
 */
export function checkBrandMark(path: string, source: string): BrandMarkReport {
  const findings: BrandMarkFinding[] = [];
  const wordmark = readWordmarkBinding(source);
  const lockupAuthored = wordmark !== undefined && !isPlaceholderAuthoredValue(wordmark);

  if (!lockupAuthored) {
    return { path, lockupAuthored: false, findings };
  }

  const exports = exportedFunctions(source);

  if (!exports.has(BRAND_LOCKUP_EXPORT)) {
    findings.push({
      rule: "mark:missing-lockup-export",
      message: `export function ${BRAND_LOCKUP_EXPORT} is required once ${BRAND_WORDMARK_BINDING} is authored`,
    });
  }

  if (!exports.has(BRAND_MARK_ONLY_EXPORT)) {
    findings.push({
      rule: "mark:missing-mark-only-export",
      message: `export function ${BRAND_MARK_ONLY_EXPORT} is required once ${BRAND_WORDMARK_BINDING} is authored`,
    });
  }

  if (!exports.has(BRAND_LOCKUP_INVERSE_EXPORT)) {
    findings.push({
      rule: "mark:missing-inverse-variant",
      message: `export function ${BRAND_LOCKUP_INVERSE_EXPORT} is required once ${BRAND_WORDMARK_BINDING} is authored`,
    });
  } else if (!inverseVariantSatisfied(source, exports)) {
    findings.push({
      rule: "mark:missing-inverse-variant",
      message: `${BRAND_LOCKUP_INVERSE_EXPORT} must use ${INVERSE_SURFACE_CLASS} and ${INVERSE_INK_CLASS} so the lockup stays legible on an inverse ground`,
    });
  }

  return { path, lockupAuthored: true, findings };
}
