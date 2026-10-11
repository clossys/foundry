import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkFieldBrandCss } from "./field-brand-css.js";
import { parseBrandDeclarations } from "./parse-brand-declarations.js";

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
  it.each([
    ["escaped prefix", String.raw`\2d\2d ui-field-alpha: 0.60;`],
    ["mixed escaped prefix", String.raw`-\2d ui-field-alpha: 0.60;`],
    ["initial hex", String.raw`--\75i-field-alpha: 0.60;`],
    ["hex with separator", String.raw`--\75 i-field-alpha: 0.60;`],
    ["padded hex", String.raw`--\000075i-field-alpha: 0.60;`],
    ["simple escape", String.raw`--\ui-field-alpha: 0.60;`],
  ])("declines escaped field identifiers: %s", (_name, declaration) => {
    const css = overlay.replace("--ui-field-alpha: 0.34;", `--ui-field-alpha: 0.34; ${declaration}`);
    expect(checkFieldBrandCss(css, tokensCss)).toMatchObject({ ok: false, unchecked: expect.arrayContaining([expect.objectContaining({ rule: "field-alpha-contrast" })]) });
    expect(parseBrandDeclarations(css)).toMatchObject({ declarations: { "--ui-field-alpha": "0.34" }, unchecked: [] });
  });
  it("declines escaped field alias dependency identifiers", () => {
    const css = overlay.replace("--ui-field-alpha: 0.34;", "--ui-field-alpha: var(--custom-alpha, 0.34);") + String.raw`:root { --custom-alpha: 0.34; --\63ustom-alpha: 0.60; }`;
    expect(checkFieldBrandCss(css, tokensCss)).toMatchObject({ ok: false, unchecked: expect.arrayContaining([expect.objectContaining({ rule: "field-alpha-contrast" })]) });
  });
  it("ignores escaped identifiers unrelated to field dependencies", () => {
    expect(checkFieldBrandCss(overlay + String.raw`:root { --\75nrelated-size: 2rem; }`, tokensCss)).toMatchObject({ ok: true, unchecked: [] });
  });
  const unsupportedCases = [
    ["escaped important initial", overlay.replace("--ui-field-alpha: 0.34;", String.raw`--ui-field-alpha: 0.60 !\69mportant; --ui-field-alpha: 0.34;`)],
    ["escaped important middle", overlay.replace("--ui-field-alpha: 0.34;", String.raw`--ui-field-alpha: 0.60 !impor\74 ant; --ui-field-alpha: 0.34;`)],
    ["same-rule important", overlay.replace("--ui-field-alpha: 0.34;", "--ui-field-alpha: 0.60 !important; --ui-field-alpha: 0.34;")],
    ["separate-rule important", ':root[data-brand-bound] { --ui-field-alpha: 0.60 !important; }' + overlay],
    ["nested ampersand", overlay.replace("--ui-field-alpha: 0.34;", "--ui-field-alpha: 0.60; & .example { --ui-field-alpha: 0.34; }")],
    ["nested pseudo selector", overlay.replace("--ui-field-alpha: 0.34;", "--ui-field-alpha: 0.60; .child:hover { --ui-field-alpha: 0.34; }")],
    ["nested child", overlay.replace("--ui-field-alpha: 0.34;", "--ui-field-alpha: 0.60; .child { --ui-field-alpha: 0.34; }")],
  ];
  it.each(unsupportedCases)("declines unsupported field cascade: %s", (_name, css) => {
    const result = checkFieldBrandCss(css!, tokensCss);
    expect(result.ok).toBe(false);
    expect(result.unchecked.length).toBeGreaterThan(0);
  });
  it.each([
    ["escaped important alias", String.raw`--custom-alpha: 0.60 !\69mportant; --custom-alpha: 0.34;`],
    ["important alias", "--custom-alpha: 0.60 !important; --custom-alpha: 0.34;"],
    ["nested alias", "--custom-alpha: 0.60; & .example { --custom-alpha: 0.34; }"],
  ])("declines unsupported field dependency cascade: %s", (_name, declarations) => {
    const css = overlay.replace("--ui-field-alpha: 0.34;", "--ui-field-alpha: var(--custom-alpha, 0.34);") + `:root { ${declarations} }`;
    expect(checkFieldBrandCss(css, tokensCss)).toMatchObject({ ok: false, unchecked: expect.arrayContaining([expect.objectContaining({ rule: "field-alpha-contrast" })]) });
  });
  it("does not poison field checks with unrelated importance or nested declarations", () => {
    const css = overlay + ':root { --unrelated-size: 2rem !important; --unrelated-size: 3rem; & .example { --unrelated-size: 4rem; } }';
    expect(checkFieldBrandCss(css, tokensCss)).toMatchObject({ ok: true, unchecked: [] });
  });
  it("preserves the public flattened parser result for unsupported field cascades", () => {
    for (const [, css] of unsupportedCases) expect(parseBrandDeclarations(css!)).toMatchObject({ declarations: { "--ui-field-alpha": "0.34" }, unchecked: [] });
  });

});
