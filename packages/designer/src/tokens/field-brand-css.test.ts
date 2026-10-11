import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkFieldBrandCss } from "./field-brand-css.js";

const tokensCss = readFileSync(resolve(import.meta.dirname, "../../styles/tokens.css"), "utf8");
const overlay = ':root[data-brand-bound] { --color-field-dot: var(--color-ink-on-inverse); --ui-field-alpha: 0.34; --ui-field-scale: 1; --ui-field-lens: 13.75rem; }';

describe("field brand CSS checks the emitted theme cascade", () => {
  it("merges the real token stylesheet with the default field brand declarations", () => {
    expect(checkFieldBrandCss(overlay, tokensCss)).toMatchObject({ ok: true, unchecked: [], contrast: { light: expect.closeTo(5.39038, 4), dark: expect.closeTo(7.34547, 4) } });
  });
  it("does not flatten away an unsafe light override followed by a safe dark override", () => {
    const css = overlay.replace("0.34", "0.40") + ':root[data-brand-bound][data-theme="dark"] { --ui-field-alpha: 0.34; }';
    const result = checkFieldBrandCss(css, tokensCss);
    expect(result.ok).toBe(false);
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "field-alpha-contrast", theme: "light" })]));
  });
  it("also checks automatic dark mode, including a failure hidden by a safe explicit-dark override", () => {
    const css = overlay + '@media (prefers-color-scheme: dark) { :root[data-brand-bound]:not([data-theme="light"]) { --ui-field-alpha: 0.60; } } :root[data-brand-bound][data-theme="dark"] { --ui-field-alpha: 0.34; }';
    expect(checkFieldBrandCss(css, tokensCss).findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "field-alpha-contrast", theme: "dark" })]));
  });
  it("ignores unrelated scoped and print bindings without changing field coverage", () => {
    const css = overlay + '.other { --unrelated-size: 2rem; } @media print { :root { --unrelated-ink: red; } }';
    expect(checkFieldBrandCss(css, tokensCss)).toMatchObject({ ok: true, unchecked: [] });
  });
  it("follows custom alias dependencies into unsupported scoped bindings", () => {
    const css = overlay.replace('var(--color-ink-on-inverse)', 'var(--custom-dot)') + ':root { --custom-dot: var(--color-ink-on-inverse); } .other { --custom-dot: red; }';
    expect(checkFieldBrandCss(css, tokensCss).unchecked.length).toBeGreaterThan(0);
  });
  it("fails closed when conditional or scoped field bindings cannot be resolved", () => {
    for (const extra of ['@supports (display: grid) { :root[data-brand-bound] { --ui-field-alpha: 0.60; } }', '.unknown { --ui-field-scale: 2; }']) {
      expect(checkFieldBrandCss(overlay + extra, tokensCss).unchecked.length).toBeGreaterThan(0);
    }
  });
});
