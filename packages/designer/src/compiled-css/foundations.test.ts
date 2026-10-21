import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(import.meta.dirname, "../../styles/compiled.css"), "utf8");
const tokenCss = readFileSync(resolve(import.meta.dirname, "../../styles/tokens.css"), "utf8");
const themeKeys = readFileSync(resolve(import.meta.dirname, "../../styles/theme-keys.css"), "utf8");

interface Rule { headers: string[]; body: string }

// Follow nested media/selector blocks rather than borrowing a declaration from
// another utility that happens to occur nearby in the generated stylesheet.
function rules(source: string, parents: string[] = []): Rule[] {
  const result: Rule[] = [];
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "");
  let start = 0;
  while (start < clean.length) {
    const open = clean.indexOf("{", start);
    if (open < 0) break;
    const header = clean.slice(start, open).split(";").at(-1)!.trim();
    let depth = 1;
    let end = open + 1;
    let quote = "";
    for (; end < clean.length && depth > 0; end += 1) {
      const char = clean[end]!;
      if (char === "\\") { end += 1; continue; }
      if (quote) { if (char === quote) quote = ""; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
    }
    const body = clean.slice(open + 1, end - 1);
    const headers = [...parents, header];
    result.push({ headers, body }, ...rules(body, headers));
    start = end;
  }
  return result;
}

const compiledRules = rules(css);
function owns(rule: Rule, name: string): boolean {
  return rule.headers.some(header => new RegExp(`\\.${name}(?![\\w-])`).test(header));
}
function utility(name: string): string {
  const own = compiledRules.filter(rule => owns(rule, name));
  expect(own.length, `compiled rule for ${name}`).toBeGreaterThan(0);
  return own.map(rule => `${rule.headers.join(" ")} {${rule.body}}`).join("\n");
}
function contextual(name: string, context: RegExp): string {
  const own = compiledRules.filter(rule => owns(rule, name) && rule.headers.some(header => context.test(header)));
  expect(own.length, `${name} in ${context}`).toBeGreaterThan(0);
  return own.map(rule => rule.body).join("\n");
}
function keyframes(name: string, reduced = false): string {
  const found = compiledRules.filter(rule => rule.headers.at(-1) === `@keyframes ${name}`
    && rule.headers.some(header => /prefers-reduced-motion\s*:\s*reduce/.test(header)) === reduced);
  expect(found, `keyframes ${name}`).toHaveLength(1);
  return found[0]!.body;
}

describe("R2 foundation compiled CSS", () => {
  it("keeps transition defaults in the theme engine and enlarges only the prescribed coarse-pointer geometry", () => {
    const theme = rules(themeKeys).filter(rule => rule.headers.at(-1) === "@theme inline").map(rule => rule.body).join("\n");
    expect(theme).toMatch(/--default-transition-duration\s*:\s*var\(--ui-duration-fast\b/);
    expect(theme).toMatch(/--default-transition-timing-function\s*:\s*var\(--ease-default\b/);
    const coarse = rules(tokenCss).filter(rule => rule.headers.some(header => /pointer\s*:\s*coarse/.test(header)))
      .map(rule => rule.body).join("\n");
    expect(coarse).toMatch(/--ui-control-mark\s*:\s*20px/);
    expect(coarse).toMatch(/--ui-control-switch-w\s*:\s*44px/);
    expect(coarse).toMatch(/--ui-control-switch-h\s*:\s*24px/);
    expect(coarse).not.toMatch(/--ui-control-switch-thumb\s*:/);
  });

  it.each([
    "tap-target", "focus-ring", "focus-ring-inset", "focus-ring-inverse",
    "control-row", "control-text", "control-h-sm", "control-h-md", "control-h-lg",
    "table-row-density", "ui-loading-delayed", "ui-pending-label", "ui-skeleton",
    "ui-progress-slide", "ui-nav-trickle",
  ])("emits the standalone %s utility", name => {
    expect(utility(name)).toContain(`.${name}`);
  });

  it.each(["focus-ring", "focus-ring-inset", "focus-ring-inverse"])(
    "%s has a visible token outline and forced-colors Highlight", name => {
      const rule = utility(name);
      expect(rule).toMatch(/focus-visible|data-focus-visible/);
      expect(rule).toMatch(/outline(?:-width)?\s*:[^;{}]*var\(--ui-border-focus\b/);
      expect(rule).toMatch(/outline-offset\s*:[^;{}]*var\(--ui-focus-offset\b/);
      expect(rule).toContain(name === "focus-ring-inverse" ? "--color-focus-ring-on-inverse" : "--color-focus-ring");
      expect(contextual(name, /forced-colors\s*:\s*active/)).toMatch(/outline(?:-color)?\s*:[^;{}]*Highlight/);
      if (name === "focus-ring-inset") expect(rule).toMatch(/outline-offset\s*:[^;{}]*(?:calc\([^;{}]*-1|-\s*var\()/);
    },
  );

  it("reserves logical 44px hit regions without changing the small visual height", () => {
    for (const name of ["tap-target", "control-h-sm"]) {
      const before = contextual(name, /::?before/);
      expect(before).toMatch(/min-inline-size\s*:[^;{}]*(?:44px|--ui-layout-tap-target)/);
      expect(before).toMatch(/min-block-size\s*:[^;{}]*(?:44px|--ui-layout-tap-target)/);
      expect(before).toMatch(/position\s*:\s*absolute/);
    }
    expect(utility("control-h-sm")).toMatch(/(?:min-)?block-size\s*:[^;{}]*--ui-control-h-sm/);
    expect(utility("control-h-md")).toMatch(/(?:min-)?block-size\s*:[^;{}]*--ui-control-h-md/);
    expect(utility("control-h-lg")).toMatch(/(?:min-)?block-size\s*:[^;{}]*--ui-control-h-lg/);
  });

  it("adapts row, text and compact table density to pointer capabilities", () => {
    expect(utility("control-row")).toContain("--ui-control-row-h");
    expect(contextual("control-row", /pointer\s*:\s*coarse/)).toMatch(/(?:min-)?block-size\s*:[^;{}]*(?:44px|--ui-layout-tap-target)/);
    expect(utility("control-text")).toContain("--text-body");
    expect(contextual("control-text", /pointer\s*:\s*coarse/)).toContain("--text-body-l");
    expect(utility("table-row-density")).toContain("--ui-table-row-comfortable");
    const compact = compiledRules.filter(rule => owns(rule, "table-row-density") && rule.body.includes("--ui-table-row-compact"));
    expect(compact.length).toBeGreaterThan(0);
    // Only inspect the actual compact declaration's enclosing rule, not a parent
    // block that also contains the fine-pointer rule.
    for (const rule of compact.filter(rule => !rule.body.includes("{"))) {
      expect(rule.headers.join(" ")).toMatch(/pointer\s*:\s*fine/);
      expect(rule.headers.join(" ")).toMatch(/compact/);
    }
    expect(compact.some(rule => !rule.body.includes("{"))).toBe(true);
  });

  it("delays reveal and pending-label hiding without removing reserved layout", () => {
    for (const [name, animation] of [["ui-loading-delayed", "ui-loading-reveal"], ["ui-pending-label", "ui-loading-hide"]]) {
      const rule = utility(name!);
      expect(rule).toMatch(new RegExp(`animation\\s*:[^;{}]*${animation}`));
      expect(rule).toContain("--ui-duration-loading-delay");
      expect(rule).toMatch(/\b1ms\b/);
      expect(rule).toMatch(/\blinear\b/);
      expect(rule).toMatch(/\bboth\b/);
      expect(rule).not.toMatch(/(?:display\s*:\s*none|visibility\s*:\s*hidden)/);
    }
    expect(keyframes("ui-loading-reveal")).toMatch(/(?:from|0%)\s*\{\s*opacity:\s*0/);
    expect(keyframes("ui-loading-reveal")).toMatch(/(?:to|100%)\s*\{\s*opacity:\s*1/);
    expect(keyframes("ui-loading-hide")).toMatch(/(?:to|100%)\s*\{\s*opacity:\s*0/);
    expect(keyframes("ui-loading-hide")).not.toMatch(/display|visibility/);
  });

  it("keeps a skeleton edge visible in forced colors", () => {
    const forced = contextual("ui-skeleton", /forced-colors\s*:\s*active/);
    expect(forced).toContain("--ui-border-hairline");
    expect(forced).toMatch(/\bdashed\b/);
    expect(forced).toMatch(/\bGrayText\b/);
  });

  it("mirrors the 40% indeterminate slide and caps the monotone navigation trickle", () => {
    const slide = utility("ui-progress-slide");
    expect(slide).toMatch(/(?:inline-size|width)\s*:\s*40%/);
    expect(slide).toContain("--ui-duration-flash");
    expect(slide).toContain("--ease-default");
    expect(slide).toMatch(/infinite/);
    expect(contextual("ui-progress-slide", /:dir\(rtl\)/)).toContain("ui-progress-slide-rtl");
    expect(keyframes("ui-progress-slide")).toMatch(/translateX\(-100%\)/);
    expect(keyframes("ui-progress-slide")).toMatch(/translateX\(250%\)/);
    expect(keyframes("ui-progress-slide-rtl")).toMatch(/translateX\(100%\)/);
    expect(keyframes("ui-progress-slide-rtl")).toMatch(/translateX\(-250%\)/);
    const trickle = utility("ui-nav-trickle");
    expect(trickle).toContain("--ui-duration-loading-long");
    expect(trickle).toMatch(/transform-origin\s*:\s*(?:left|0(?:%|px)?)(?:\s|;)/);
    expect(contextual("ui-nav-trickle", /:dir\(rtl\)/)).toMatch(/transform-origin\s*:\s*(?:right|100%)(?:\s|;)/);
    const stops = [...keyframes("ui-nav-trickle").matchAll(/scaleX\(\s*([\d.]+)\s*\)/g)].map(match => Number(match[1]));
    expect(stops.length).toBeGreaterThanOrEqual(2);
    expect(stops[0]).toBe(0);
    expect(stops.at(-1)).toBe(0.9);
    for (let index = 1; index < stops.length; index += 1) {
      expect(stops[index]).toBeGreaterThanOrEqual(stops[index - 1]!);
      expect(stops[index]).toBeLessThanOrEqual(0.9);
    }
  });

  it.each(["ui-progress-slide", "ui-nav-trickle"])("makes %s static and full-width under reduced motion", name => {
    const reduced = contextual(name, /prefers-reduced-motion\s*:\s*reduce/);
    expect(reduced).toMatch(/animation\s*:\s*none/);
    expect(reduced).toMatch(/(?:inline-size|width)\s*:\s*100%/);
    expect(reduced).toMatch(/transform\s*:\s*scaleX\(1\)/);
    expect(reduced).not.toMatch(/opacity\s*:\s*0/);
  });

  it.each(["overlay-fade", "overlay-pop", "overlay-zoom", "sheet-slide"])("ships the %s motion recipe", name => {
    expect(keyframes(name)).toMatch(/opacity/);
    if (name !== "overlay-fade") expect(keyframes(name)).toMatch(/transform|translate|scale/);
    if (name !== "overlay-fade") {
      expect(keyframes(name, true)).toMatch(/opacity/);
      expect(keyframes(name, true)).not.toMatch(/transform|translate|scale/);
    }
  });
});

describe("coarse token cascade", () => {
  it("keeps the three coarse-pointer overrides inside the existing token layer", () => {
    const roots = rules(tokenCss).filter(rule => rule.headers.at(-1) === ":root"
      && rule.headers.some(header => /pointer\s*:\s*coarse/.test(header)));
    expect(roots).toHaveLength(1);
    expect(roots[0]!.headers).toContain("@layer foundry-ui-tokens");
  });
});
