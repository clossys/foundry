import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDeclarationsForSelector, parseRootDeclarations } from "./internal/parse-css.js";
import { specificity, selectorMatches, resolveCascade, type CascadeRule } from "./internal/cascade.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tokensCss = readFileSync(join(packageRoot, "styles", "tokens.css"), "utf8");
const brandTemplateCss = readFileSync(join(packageRoot, "styles", "brand-template.css"), "utf8");

const LIGHT_SELECTOR = ":root";
const DARK_MEDIA_SELECTOR = ':root:not([data-theme="light"])';
const DARK_EXPLICIT_SELECTOR = ':root[data-theme="dark"]';

const BRAND_LIGHT_SELECTOR = ":root[data-brand-bound]";
const BRAND_DARK_MEDIA_SELECTOR = ':root[data-brand-bound]:not([data-theme="light"])';
const BRAND_DARK_EXPLICIT_SELECTOR = ':root[data-brand-bound][data-theme="dark"]';

/**
 * The task this test exists for put it plainly: "verify the resulting
 * specificity actually works ... Test this, don't reason about it." This
 * simulates a real browser's cascade resolution (see `internal/cascade.ts`)
 * against the REAL selector text in `styles/tokens.css` and
 * `styles/brand-template.css` — not a hand-copied restatement of them —
 * for every combination of {no attribute, `data-theme="light"`,
 * `data-theme="dark"`} x {OS prefers light, OS prefers dark} that a real
 * consumer can produce.
 */
describe("dark-mode cascade — tokens.css", () => {
  const MARKER_PROPERTY = "--color-surface-base";
  const lightValue = parseRootDeclarations(tokensCss).get(MARKER_PROPERTY)!;
  const darkMediaValue = parseDeclarationsForSelector(tokensCss, DARK_MEDIA_SELECTOR).get(MARKER_PROPERTY)!;
  const darkExplicitValue = parseDeclarationsForSelector(tokensCss, DARK_EXPLICIT_SELECTOR).get(MARKER_PROPERTY)!;

  it("the marker property actually has three real, distinct-by-role declarations to test against", () => {
    expect(lightValue).toBeTruthy();
    expect(darkMediaValue).toBeTruthy();
    expect(darkExplicitValue).toBeTruthy();
    expect(darkMediaValue).toBe(darkExplicitValue); // same dark value, reached two different ways
    expect(darkMediaValue).not.toBe(lightValue);
  });

  const rules: CascadeRule[] = [
    { selector: LIGHT_SELECTOR, insideDarkMedia: false, sourceIndex: 0, value: lightValue },
    { selector: DARK_MEDIA_SELECTOR, insideDarkMedia: true, sourceIndex: 1, value: darkMediaValue },
    { selector: DARK_EXPLICIT_SELECTOR, insideDarkMedia: false, sourceIndex: 2, value: darkExplicitValue },
  ];

  it.each([
    { dataTheme: undefined, osDark: false, expected: "light", label: "no attribute, OS light" },
    { dataTheme: undefined, osDark: true, expected: "dark", label: "no attribute, OS dark -> follows OS" },
    { dataTheme: "light" as const, osDark: false, expected: "light", label: 'data-theme="light", OS light' },
    {
      dataTheme: "light" as const,
      osDark: true,
      expected: "light",
      label: 'data-theme="light", OS dark -> explicit light still wins',
    },
    {
      dataTheme: "dark" as const,
      osDark: false,
      expected: "dark",
      label: 'data-theme="dark", OS light -> explicit dark still wins',
    },
    { dataTheme: "dark" as const, osDark: true, expected: "dark", label: 'data-theme="dark", OS dark' },
  ])("$label", ({ dataTheme, osDark, expected }) => {
    const winner = resolveCascade(rules, { brandBound: false, dataTheme, osDark });
    expect(winner).toBeDefined();
    expect(winner!.value).toBe(expected === "light" ? lightValue : darkMediaValue);
  });

  it('specificity: ":root[data-theme=\\"dark\\"]" and the media-query form both beat plain ":root"', () => {
    expect(specificity(DARK_EXPLICIT_SELECTOR)).toBeGreaterThan(specificity(LIGHT_SELECTOR));
    expect(specificity(DARK_MEDIA_SELECTOR)).toBeGreaterThan(specificity(LIGHT_SELECTOR));
  });
});

/**
 * Same simulation, one specificity class higher (`[data-brand-bound]`
 * added throughout) — the task calls this pairing out explicitly:
 * `:root[data-brand-bound][data-theme="dark"]` must beat
 * `:root[data-brand-bound]`, and the media-query form must beat the plain
 * brand binding without beating an explicit `data-theme="light"`.
 * `brand-template.css`'s dark slots are blank (it's a template — see
 * `theme-parity.test.ts` for its name-coverage check), so this test
 * verifies the SELECTORS and their cascade behavior, not resolved values.
 */
describe("dark-mode cascade — brand-template.css", () => {
  it("all three brand selectors are the real, exact text this package ships (not a hand-copied guess)", () => {
    // parseDeclarationsForSelector throws if the exact selector text isn't
    // found — a passing call here IS the existence check.
    expect(() => parseDeclarationsForSelector(brandTemplateCss, BRAND_LIGHT_SELECTOR)).not.toThrow();
    expect(() => parseDeclarationsForSelector(brandTemplateCss, BRAND_DARK_MEDIA_SELECTOR)).not.toThrow();
    expect(() => parseDeclarationsForSelector(brandTemplateCss, BRAND_DARK_EXPLICIT_SELECTOR)).not.toThrow();
  });

  it('":root[data-brand-bound][data-theme=\\"dark\\"]" beats ":root[data-brand-bound]"', () => {
    expect(specificity(BRAND_DARK_EXPLICIT_SELECTOR)).toBeGreaterThan(specificity(BRAND_LIGHT_SELECTOR));
  });

  it('the media-query form beats ":root[data-brand-bound]" ...', () => {
    expect(specificity(BRAND_DARK_MEDIA_SELECTOR)).toBeGreaterThan(specificity(BRAND_LIGHT_SELECTOR));
  });

  it('... but never MATCHES when data-theme="light" is set, so it can never beat explicit light regardless of specificity', () => {
    expect(selectorMatches(BRAND_DARK_MEDIA_SELECTOR, { brandBound: true, dataTheme: "light" })).toBe(false);
    expect(selectorMatches(BRAND_DARK_MEDIA_SELECTOR, { brandBound: true, dataTheme: "dark" })).toBe(true);
    expect(selectorMatches(BRAND_DARK_MEDIA_SELECTOR, { brandBound: true, dataTheme: undefined })).toBe(true);
  });

  const rules: CascadeRule[] = [
    { selector: BRAND_LIGHT_SELECTOR, insideDarkMedia: false, sourceIndex: 0, value: "LIGHT" },
    { selector: BRAND_DARK_MEDIA_SELECTOR, insideDarkMedia: true, sourceIndex: 1, value: "DARK" },
    { selector: BRAND_DARK_EXPLICIT_SELECTOR, insideDarkMedia: false, sourceIndex: 2, value: "DARK" },
  ];

  it.each([
    { dataTheme: undefined, osDark: false, expected: "LIGHT", label: "no attribute, OS light" },
    { dataTheme: undefined, osDark: true, expected: "DARK", label: "no attribute, OS dark" },
    { dataTheme: "light" as const, osDark: true, expected: "LIGHT", label: 'data-theme="light" beats OS dark' },
    { dataTheme: "dark" as const, osDark: false, expected: "DARK", label: 'data-theme="dark" beats OS light' },
  ])("full cascade resolves correctly: $label", ({ dataTheme, osDark, expected }) => {
    const winner = resolveCascade(rules, { brandBound: true, dataTheme, osDark });
    expect(winner?.value).toBe(expected);
  });

  it("an unbound element (no data-brand-bound) never matches any brand rule, in any theme state", () => {
    for (const dataTheme of [undefined, "light" as const, "dark" as const]) {
      for (const osDark of [false, true]) {
        const winner = resolveCascade(rules, { brandBound: false, dataTheme, osDark });
        expect(winner).toBeUndefined();
      }
    }
  });
});
