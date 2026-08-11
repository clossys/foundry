import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { TOKENS } from "./tokens.js";
import { findAllCustomPropertyNames } from "./internal/parse-css.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const brandTemplateCss = readFileSync(join(packageRoot, "styles", "brand-template.css"), "utf8");
const namesInTemplate = findAllCustomPropertyNames(brandTemplateCss);

describe("brand-template.css covers every brandable token", () => {
  it("every token marked brandable in src/tokens.ts appears in brand-template.css", () => {
    const brandable = Object.values(TOKENS).filter((def) => def.brandable);
    expect(brandable.length).toBeGreaterThan(0);
    const missing = brandable.filter((def) => !namesInTemplate.has(def.property)).map((def) => def.property);
    expect(missing).toEqual([]);
  });

  it("brand-template.css names no property this package doesn't declare", () => {
    // Guards the other direction: a stale or typo'd slot in the template
    // (e.g. a renamed token whose old name was never removed) would
    // otherwise go unnoticed, since it's harmless CSS on its own.
    const unknown = [...namesInTemplate].filter((name) => !(name in TOKENS));
    expect(unknown).toEqual([]);
  });

  it("no NON-brandable token is live (uncommented) in brand-template.css", () => {
    // A structural token (the neutral ramp, the type-size ramp, spacing,
    // z-index, ...) appearing as a LIVE declaration here would invite a
    // brand to override something this package considers fixed. Being
    // named in a comment (as an OPTIONAL example, or explaining why an
    // alias needs no restatement) is fine; only an active, uncommented
    // declaration is a defect.
    const liveDeclarationRe = /^\s*(--[a-zA-Z0-9-]+)\s*:/gm;
    const strippedOfComments = brandTemplateCss.replace(/\/\*[\s\S]*?\*\//g, "");
    const live = new Set([...strippedOfComments.matchAll(liveDeclarationRe)].map((m) => m[1]!));
    const notBrandable = Object.values(TOKENS)
      .filter((def) => !def.brandable)
      .map((def) => def.property);
    const wronglyLive = [...live].filter((name) => notBrandable.includes(name));
    expect(wronglyLive).toEqual([]);
  });
});
