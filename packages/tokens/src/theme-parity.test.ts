import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { TOKENS } from "./tokens.js";
import { parseDeclarationsForSelector, findAllCustomPropertyNames } from "./internal/parse-css.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const tokensCss = readFileSync(join(packageRoot, "styles", "tokens.css"), "utf8");
const brandTemplateCss = readFileSync(join(packageRoot, "styles", "brand-template.css"), "utf8");

const DARK_MEDIA_SELECTOR = ':root:not([data-theme="light"])';
const DARK_EXPLICIT_SELECTOR = ':root[data-theme="dark"]';
const BRAND_DARK_MEDIA_SELECTOR = ':root[data-brand-bound]:not([data-theme="light"])';
const BRAND_DARK_EXPLICIT_SELECTOR = ':root[data-brand-bound][data-theme="dark"]';

const tokensDarkMedia = parseDeclarationsForSelector(tokensCss, DARK_MEDIA_SELECTOR);
const tokensDarkExplicit = parseDeclarationsForSelector(tokensCss, DARK_EXPLICIT_SELECTOR);

/**
 * The other half of the dark-mode contract (see `src/dark-mode-cascade.test.ts`
 * for the cascade/specificity half): `src/tokens.ts`'s `themeDependent` flag
 * and `styles/tokens.css`'s two dark blocks are two independently-maintained
 * descriptions of the same 35-token split, exactly the way `src/tokens.ts`
 * and the light `:root` block are two independent descriptions of the same
 * 128 tokens (see `parity.test.ts`). Nothing generates one from the other,
 * so this is what actually keeps them in sync, checked in both directions:
 * every `themeDependent: true` token has a value in BOTH dark blocks, and
 * no `themeDependent: false` token appears in EITHER — an invariant token
 * that picked up a stray dark override would silently diverge from its
 * light value with no visible signal until someone toggled the theme.
 */
describe("tokens.css dark blocks <-> src/tokens.ts `themeDependent` parity", () => {
  it("the dark media-query block and the dark explicit-override block declare the same set of properties", () => {
    const mediaNames = new Set(tokensDarkMedia.keys());
    const explicitNames = new Set(tokensDarkExplicit.keys());
    expect([...mediaNames].sort()).toEqual([...explicitNames].sort());
  });

  it("the two dark blocks declare identical values for every property (correctness over DRY, kept honest by this test)", () => {
    const mismatched: Array<{ name: string; media: string; explicit: string }> = [];
    for (const [name, mediaValue] of tokensDarkMedia) {
      const explicitValue = tokensDarkExplicit.get(name);
      if (explicitValue !== undefined && explicitValue !== mediaValue) {
        mismatched.push({ name, media: mediaValue, explicit: explicitValue });
      }
    }
    expect(mismatched).toEqual([]);
  });

  it("every themeDependent token has a value in both dark blocks", () => {
    const dependent = Object.values(TOKENS).filter((def) => def.themeDependent);
    expect(dependent.length).toBeGreaterThan(0);
    const missingFromMedia = dependent.filter((def) => !tokensDarkMedia.has(def.property)).map((def) => def.property);
    const missingFromExplicit = dependent
      .filter((def) => !tokensDarkExplicit.has(def.property))
      .map((def) => def.property);
    expect(missingFromMedia).toEqual([]);
    expect(missingFromExplicit).toEqual([]);
  });

  it("no themeDependent:false token appears in either dark block", () => {
    const invariant = Object.values(TOKENS).filter((def) => !def.themeDependent);
    const wronglyInMedia = invariant.filter((def) => tokensDarkMedia.has(def.property)).map((def) => def.property);
    const wronglyInExplicit = invariant
      .filter((def) => tokensDarkExplicit.has(def.property))
      .map((def) => def.property);
    expect(wronglyInMedia).toEqual([]);
    expect(wronglyInExplicit).toEqual([]);
  });

  it("the dark blocks declare exactly the 35 tokens this package's design marks theme-dependent", () => {
    expect(tokensDarkMedia.size).toBe(35);
    expect(tokensDarkExplicit.size).toBe(35);
    expect(Object.values(TOKENS).filter((def) => def.themeDependent).length).toBe(35);
  });
});

/**
 * `brand-template.css`'s two dark blocks are a fill-in-the-blank TEMPLATE,
 * not real values (see `brand-coverage.test.ts` for the equivalent check on
 * its light block) — so this checks NAME coverage, the same way
 * `brand-coverage.test.ts` does, rather than value parity.
 */
describe("brand-template.css dark blocks cover every brandable + theme-dependent token", () => {
  const namesInTemplate = findAllCustomPropertyNames(brandTemplateCss);
  const brandableAndDependent = Object.values(TOKENS).filter((def) => def.brandable && def.themeDependent);

  it("every brandable + theme-dependent token appears in brand-template.css", () => {
    expect(brandableAndDependent.length).toBeGreaterThan(0);
    const missing = brandableAndDependent.filter((def) => !namesInTemplate.has(def.property)).map((def) => def.property);
    expect(missing).toEqual([]);
  });

  it("the dark blocks contain exactly the 33 tokens that are both brandable and theme-dependent", () => {
    const media = parseDeclarationsForSelector(brandTemplateCss, BRAND_DARK_MEDIA_SELECTOR);
    const explicit = parseDeclarationsForSelector(brandTemplateCss, BRAND_DARK_EXPLICIT_SELECTOR);
    expect(media.size).toBe(33);
    expect(explicit.size).toBe(33);
    expect([...media.keys()].sort()).toEqual(brandableAndDependent.map((def) => def.property).sort());
    expect([...explicit.keys()].sort()).toEqual(brandableAndDependent.map((def) => def.property).sort());
  });

  it("no token that is theme-invariant OR not brandable is live in either dark block", () => {
    const media = parseDeclarationsForSelector(brandTemplateCss, BRAND_DARK_MEDIA_SELECTOR);
    const explicit = parseDeclarationsForSelector(brandTemplateCss, BRAND_DARK_EXPLICIT_SELECTOR);
    const allowed = new Set(brandableAndDependent.map((def) => def.property));
    const wrongInMedia = [...media.keys()].filter((name) => !allowed.has(name));
    const wrongInExplicit = [...explicit.keys()].filter((name) => !allowed.has(name));
    expect(wrongInMedia).toEqual([]);
    expect(wrongInExplicit).toEqual([]);
  });
});
