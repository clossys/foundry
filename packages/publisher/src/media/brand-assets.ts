/**
 * Closed brand-asset roles on top of the image/video registry.
 * The consumer fills a master SVG the way they fill brand.css. This module
 * records the required derivatives and refuses a roster that is missing a
 * role or has the wrong pixel size. Licence stays a coverage warning on the
 * image/video registry; it is not a new enum here.
 */

export const BRAND_ASSET_ROLES = [
  "favicon-svg",
  "favicon-32",
  "apple-touch-180",
  "maskable-192",
  "maskable-512",
  "open-graph",
  "twitter-image",
  "email-png",
] as const;

export type BrandAssetRole = (typeof BRAND_ASSET_ROLES)[number];

export interface BrandAssetEntry {
  role: BrandAssetRole;
  src: string;
  width: number;
  height: number;
  alt: string;
}

export interface BrandAssetFinding {
  role: BrandAssetRole | "master";
  message: string;
}

const ROLE_SIZE: Record<Exclude<BrandAssetRole, "favicon-svg">, { width: number; height: number }> = {
  "favicon-32": { width: 32, height: 32 },
  "apple-touch-180": { width: 180, height: 180 },
  "maskable-192": { width: 192, height: 192 },
  "maskable-512": { width: 512, height: 512 },
  "open-graph": { width: 1200, height: 630 },
  "twitter-image": { width: 1200, height: 630 },
  "email-png": { width: 600, height: 200 },
};

const SVG_DOCUMENT = /^[\s\uFEFF]*<svg(?:\s|>)/i;

export function requiredBrandAssetSize(role: Exclude<BrandAssetRole, "favicon-svg">): { width: number; height: number } {
  return ROLE_SIZE[role];
}

/**
 * Reads a master SVG and records the favicon-svg role from it. Raster roles
 * stay findings until the caller supplies an entry at the required pixel size.
 */
export function deriveBrandAssetRoster(masterSvg: string, supplied: readonly BrandAssetEntry[] = []): { entries: BrandAssetEntry[]; findings: BrandAssetFinding[] } {
  const findings: BrandAssetFinding[] = [];
  if (!SVG_DOCUMENT.test(masterSvg) || !/<\/svg\s*>/i.test(masterSvg)) {
    findings.push({ role: "master", message: "master mark must be a complete <svg> document" });
    return { entries: [], findings: [...findings, ...missingRasterFindings(supplied)] };
  }
  const derived: BrandAssetEntry = {
    role: "favicon-svg",
    src: masterSvg.trim(),
    width: 0,
    height: 0,
    alt: supplied.find((entry) => entry.role === "favicon-svg")?.alt ?? "",
  };
  const entries = [derived, ...supplied.filter((entry) => entry.role !== "favicon-svg")];
  return { entries, findings: checkBrandAssetRoster(entries) };
}

function missingRasterFindings(supplied: readonly BrandAssetEntry[]): BrandAssetFinding[] {
  return checkBrandAssetRoster(supplied.filter((entry) => entry.role !== "favicon-svg"));
}

export function checkBrandAssetRoster(entries: readonly BrandAssetEntry[]): BrandAssetFinding[] {
  const findings: BrandAssetFinding[] = [];
  const seen = new Set<BrandAssetRole>();
  for (const entry of entries) {
    if (!BRAND_ASSET_ROLES.includes(entry.role)) {
      findings.push({ role: "master", message: `unknown brand asset role "${String(entry.role)}"` });
      continue;
    }
    if (seen.has(entry.role)) {
      findings.push({ role: entry.role, message: `role "${entry.role}" is declared more than once` });
    }
    seen.add(entry.role);
    if (typeof entry.src !== "string" || entry.src.trim().length === 0) {
      findings.push({ role: entry.role, message: `${entry.role} requires a non-empty src` });
    }
    if (typeof entry.alt !== "string" || entry.alt.trim().length === 0) {
      findings.push({ role: entry.role, message: `${entry.role} requires alt text` });
    }
    if (entry.role === "favicon-svg") {
      if (!SVG_DOCUMENT.test(entry.src) || !/<\/svg\s*>/i.test(entry.src)) {
        findings.push({ role: entry.role, message: "favicon-svg src must be a complete <svg> document" });
      }
      continue;
    }
    const size = ROLE_SIZE[entry.role];
    if (entry.width !== size.width || entry.height !== size.height) {
      findings.push({ role: entry.role, message: `${entry.role} must be ${size.width}×${size.height}, got ${entry.width}×${entry.height}` });
    }
  }
  for (const role of BRAND_ASSET_ROLES) {
    if (!seen.has(role)) findings.push({ role, message: `missing required role "${role}"` });
  }
  return findings;
}
