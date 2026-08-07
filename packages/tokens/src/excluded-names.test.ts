import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { TOKENS } from "./tokens.js";
import { findAllCustomPropertyNames } from "./internal/parse-css.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const styleFiles = ["tokens.css", "theme.css", "brand-template.css"].map((name) => ({
  name,
  text: readFileSync(join(packageRoot, "styles", name), "utf8"),
}));

/**
 * This package deliberately excludes a set of token families that belong
 * to a specific product, not to a general-purpose token vocabulary: naming
 * a product's own wordmark, its trust/provenance/agent vocabulary, texture
 * (grain/noise), eyebrow labels, system banners, marketing page sections, a
 * button typography axis, and a whole chart-color family (which belongs in
 * a separate charts package). This test asserts none of those ever leak
 * back in as a hyphen-delimited segment of a real custom property name —
 * scoped to token NAMES specifically, not prose, since several of these
 * are ordinary English words (`section`, `button`) that legitimately
 * appear in documentation sentences.
 */
const EXCLUDED_SEGMENTS = [
  "wordmark",
  "trust",
  "provenance",
  "agent",
  "grain",
  "noise",
  "eyebrow",
  "banner",
  "section",
  "button",
  "chart",
];

function segmentsOf(customPropertyName: string): string[] {
  return customPropertyName.replace(/^--/, "").split("-");
}

describe("no excluded/domain-specific token names appear anywhere", () => {
  it("no custom property name in any shipped stylesheet contains an excluded segment", () => {
    const violations: string[] = [];
    for (const file of styleFiles) {
      for (const name of findAllCustomPropertyNames(file.text)) {
        const segments = segmentsOf(name).map((s) => s.toLowerCase());
        for (const excluded of EXCLUDED_SEGMENTS) {
          if (segments.includes(excluded)) {
            violations.push(`${file.name}: "${name}" contains excluded segment "${excluded}"`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("no property key or family in src/tokens.ts contains an excluded segment", () => {
    const violations: string[] = [];
    for (const def of Object.values(TOKENS)) {
      const segments = segmentsOf(def.property).map((s) => s.toLowerCase());
      for (const excluded of EXCLUDED_SEGMENTS) {
        if (segments.includes(excluded) || def.family === excluded) {
          violations.push(`${def.property}: contains excluded segment "${excluded}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
