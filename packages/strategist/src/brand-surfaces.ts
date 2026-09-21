/**
 * Designer-facing strategy surfaces must carry explicit do-not language —
 * JSON slot coverage alone is not bindable-surface coverage.
 */

const DO_NOT_RE = /\b(do not|don't|never)\b/i;

export interface BrandSurfaceFinding {
  rule: "surface-missing-do-not";
  path: string;
  message: string;
}

export function checkBrandSurfaces(surfaceTexts: { path: string; text: string }[]): BrandSurfaceFinding[] {
  const findings: BrandSurfaceFinding[] = [];
  for (const { path, text } of surfaceTexts) {
    if (!DO_NOT_RE.test(text)) {
      findings.push({
        rule: "surface-missing-do-not",
        path,
        message: `No do-not language found in declared Designer-facing surface "${path}".`,
      });
    }
  }
  return findings;
}
