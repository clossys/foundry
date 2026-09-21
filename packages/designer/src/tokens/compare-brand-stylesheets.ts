/**
 * Compares brandable custom-property values between a primary brand overlay
 * and additional stylesheets the public surface may load.
 */

import { TOKENS } from "./tokens.js";

export interface BrandStylesheetDivergenceFinding {
  rule: "brand-slot-divergence";
  slot: string;
  overlayValue: string;
  otherValue: string;
  otherFile: string;
  message: string;
}

export function compareBrandStylesheets(
  overlay: Record<string, string>,
  otherDeclarations: Record<string, string>,
  otherFileLabel: string,
): BrandStylesheetDivergenceFinding[] {
  const findings: BrandStylesheetDivergenceFinding[] = [];
  for (const [slot, otherValue] of Object.entries(otherDeclarations)) {
    const def = TOKENS[slot as keyof typeof TOKENS];
    if (!def?.brandable) continue;
    const overlayValue = overlay[slot];
    if (overlayValue === undefined || overlayValue.trim() === "") continue;
    if (otherValue.trim() === "") continue;
    if (overlayValue.trim() === otherValue.trim()) continue;
    findings.push({
      rule: "brand-slot-divergence",
      slot,
      overlayValue,
      otherValue,
      otherFile: otherFileLabel,
      message: `Brandable slot ${slot} differs between overlay (${overlayValue.trim()}) and ${otherFileLabel} (${otherValue.trim()}).`,
    });
  }
  return findings;
}
