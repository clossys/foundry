import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { UI_OUTLINE_FOCUS, UI_OUTLINE_FOCUS_INVERSE } from "../components/internal/ui-vars.js";
import { TOKENS } from "../tokens/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(resolve(here, path), "utf8");
const block = (css: string, marker: string) => {
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  let depth = 0, end = css.indexOf("{", start);
  for (; end < css.length; end++) {
    if (css[end] === "{") depth++;
    if (css[end] === "}" && --depth === 0) break;
  }
  return css.slice(start, end + 1);
};
const utility = (name: string) => block(read("../../styles/theme-keys.css"), `@utility ${name} {`);
/** Token fallbacks are part of the token reference, not independent paint decisions. */
function withoutTokenReads(source: string): string {
  let result = "", index = 0;
  while (index < source.length) {
    if (!source.startsWith("var(", index)) { result += source[index++]; continue; }
    index += 4; let depth = 1;
    while (index < source.length && depth) {
      if (source[index] === "(") depth++;
      if (source[index] === ")") depth--;
      index++;
    }
  }
  return result;
}

describe("admin renderer token conformance", () => {
  it("retains usable normal and inverse focus roles when token CSS is unavailable", () => {
    expect(UI_OUTLINE_FOCUS).toContain(`var(--color-focus-ring, var(--color-accent, ${TOKENS["--color-accent"]!.value}))`);
    expect(UI_OUTLINE_FOCUS_INVERSE).toContain(`var(--color-focus-ring-on-inverse, var(--color-ink-on-inverse, ${TOKENS["--color-ink-on-inverse"]!.value}))`);
    expect(UI_OUTLINE_FOCUS).toContain("var(--ui-border-focus, 2px)");
  });
  it("binds AppFrame and Studio native controls to the shared focus role rather than copied widths/colors", () => {
    const frame = read("../frames/AppFrame.tsx"), rail = read("../studio/rail/StudioRail.tsx"), disclosure = read("../components/Disclosure.tsx");
    expect(frame.match(/const CONTROL = "([^"]+)"/)?.[1].split(/\s+/)).toContain("focus-ring");
    expect(rail.match(/triggerClassName="([^"]+)"/)?.[1].split(/\s+/)).toContain("focus-ring");
    expect(disclosure.slice(0, disclosure.indexOf("function DisclosureGroup"))).toContain("focus-ring");
    for (const source of [frame, rail]) expect(source).not.toMatch(/focus-visible:outline-(?:\d|offset-\d|accent)/);
    const focus = utility("focus-ring");
    for (const token of ["--ui-border-focus", "--ui-focus-offset", "--color-focus-ring"]) expect(focus).toContain(`var(${token},`);
    expect(focus).toContain(":focus-visible"); expect(focus).toContain("[data-focus-visible]");
    expect(focus).toContain("@media (forced-colors: active)");
    expect(focus).toContain("outline-color: Highlight");
    expect(utility("focus-ring-inset")).toContain("outline-offset: calc(-1 * var(--ui-focus-offset, 2px))");
  });
  it("lets the library column bound follow the existing region-width token", () => {
    const block = utility("library-column-bound");
    expect(block).toContain(`max-inline-size: var(--ui-layout-inspector-max-w, ${TOKENS["--ui-layout-inspector-max-w"]!.value})`);
    expect(withoutTokenReads(block)).not.toMatch(/\d+(?:px|rem|em)\b/);
  });
  it("keeps canvas fitting on the motion scale with reduced-motion and focus roles intact", () => {
    const canvas = read("../blocks/canvas/CanvasSurface.tsx");
    expect(canvas).toContain(`var(--ui-duration-fast, ${TOKENS["--ui-duration-fast"]!.value})`);
    expect(canvas).toContain(`var(--ease-default, ${TOKENS["--ease-default"]!.value})`);
    expect(canvas).toContain('reducedMotion ? "0s"');
    expect(canvas).toContain("motion-reduce:transition-none");
    expect(canvas).not.toMatch(/focus-visible:outline-(?:\d|accent)/);
  });
  it("has no off-scale raw paint or arbitrary design dimensions in the touched renderer sources", () => {
    for (const path of ["../frames/AppFrame.tsx", "../studio/rail/StudioRail.tsx", "../components/Disclosure.tsx", "../components/internal/ui-vars.ts", "../blocks/canvas/CanvasSurface.tsx"]) {
      const source = withoutTokenReads(read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, ""));
      expect(source, path).not.toMatch(/#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\(/i);
      expect(source, path).not.toMatch(/(?:p|m|gap|rounded|text|shadow|duration)-\[(?:\d|#)/);
    }
  });
  it("keeps paired light/dark focus palettes and the structural document skip-link geometry", () => {
    const css = read("../../styles/tokens.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const automaticDark = block(block(css.slice(css.indexOf("@layer foundry-ui-tokens", css.indexOf("--ui-state-hover-alpha"))), "@media (prefers-color-scheme: dark)"), ':root:not([data-theme="light"])');
    const explicitDark = block(css.slice(css.indexOf("@media (prefers-color-scheme: dark)")), ':root[data-theme="dark"]');
    for (const role of ["--color-accent", "--color-ink-on-inverse"]) {
      expect(TOKENS[role]!.themeDependent).toBe(true);
      expect(automaticDark).toMatch(new RegExp(`${role}:\\s*oklch\\(`));
      expect(explicitDark).toMatch(new RegExp(`${role}:\\s*oklch\\(`));
    }
    const document = read("./frames/document.tsx");
    expect(document).toContain("width:1px;height:1px");
    expect(document).toContain("margin:-1px");
    expect(document).not.toMatch(/#[\da-f]{3,8}\b|\brgba?\(/i);
  });
});
