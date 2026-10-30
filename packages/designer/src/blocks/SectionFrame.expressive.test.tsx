// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SectionFrame } from "./SectionFrame.js";
import { CallToAction } from "./CallToAction.js";
import { Hero } from "./Hero.js";
import { TOKENS } from "../tokens/tokens.js";
import { parseRootDeclarations, parseDeclarationsForSelector } from "../tokens/internal/parse-css.js";
import { contrastRatio } from "../tokens/color.js";

const css = readFileSync(new URL("../../styles/tokens.css", import.meta.url), "utf8");
describe("expressive marketing surfaces", () => {
  it("keeps each fixed minimum and derives the maximum from the existing 72/56 display ratio", () => {
    for (const [name, min] of Object.entries({ "display-xl": 72, "display-l": 56, "display-m": 44, h0: 32, h1: 28, h2: 18, h3: 14 })) {
      const value = `clamp(${min}px, ${min / 10}vw, ${(min * 72 / 56).toFixed(3)}px)`;
      expect(TOKENS[`--text-${name}`]!.value).toBe(`${min}px`);
      for (const html of [renderToStaticMarkup(<SectionFrame />), renderToStaticMarkup(<Hero heading="ExampleCo" />), renderToStaticMarkup(<CallToAction title="ExampleCo" primaryAction={null} />)]) expect(html).toContain(`--text-${name}:${value}`);
    }
  });
  it.each(["grain", "noise", "topo"] as const)("reads the registered %s pattern and wash token", texture => {
    for (const html of [renderToStaticMarkup(<SectionFrame ground="wash" texture={texture} reveal />), renderToStaticMarkup(<CallToAction title="ExampleCo" primaryAction={null} ground="wash" texture={texture} />)]) {
      expect(html).toContain(`data-texture="${texture}"`);
      expect(html).toContain("var(--gradient-wash,");
      expect(html).toContain("var(--color-line-strong)");
      expect(html).toContain("var(--color-surface-base)");
    }
    const band = renderToStaticMarkup(<SectionFrame reveal texture={texture} />);
    expect(band).toContain('data-designer-reveal=""');
    expect(band).toContain("@keyframes reveal");
    expect(renderToStaticMarkup(<SectionFrame />)).not.toContain("@keyframes reveal");
  });
  it.each(["light", "dark"])("retains AA text contrast on protected texture plates and wash endpoints in %s", theme => {
    const values = new Map(parseRootDeclarations(css));
    if (theme === "dark") for (const [key, value] of parseDeclarationsForSelector(css, ':root[data-theme="dark"]')) values.set(key, value);
    for (const surface of ["base", "raised", "sunken", "inverse"]) {
      for (const ink of surface === "inverse" ? ["on-inverse", "on-inverse-muted"] : ["primary", "secondary"]) {
        const ratio = contrastRatio(values.get(`--color-ink-${ink}`)!, values.get(`--color-surface-${surface}`)!);
        expect(ratio, `${theme}/${surface}/${ink}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const ground of ["base", "sunken", "inverse"] as const) {
      for (const html of [renderToStaticMarkup(<SectionFrame ground={ground} texture="grain" />), renderToStaticMarkup(<CallToAction ground={ground} texture="grain" title="ExampleCo" primaryAction={null} />)]) expect(html).toContain(`background-color:var(--color-surface-${ground})`);
    }
  });
});
