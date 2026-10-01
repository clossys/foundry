import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { generateCompiledCss } from "./generate.js";

const stylesDir = resolve(import.meta.dirname, "..", "..", "styles");
const committedCss = readFileSync(resolve(stylesDir, "compiled.css"), "utf8");

const BASE_OPEN = "@layer foundry-ui-base {";
const COMPILED_OPEN = "@layer foundry-ui-compiled {";

let freshCss = "";

beforeAll(async () => {
  freshCss = (await generateCompiledCss({ stylesDir, candidates: ["bg-accent", "px-md"] })).css;
});

/** Body of the first balanced `{ ... }` that follows `open` (which must end in `{`). */
function blockBody(css: string, open: string): string {
  const start = css.indexOf(open);
  if (start < 0) throw new Error(`no ${open} block`);
  let depth = 0;
  for (let i = start + open.length - 1; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start + open.length, i);
  }
  throw new Error(`unterminated ${open} block`);
}

interface Rule {
  selectors: string[];
  body: string;
}

/** Flat `selector-list { declarations }` rules, which is all the base block holds. */
function rulesOf(blockText: string): Rule[] {
  return [...blockText.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: (m[1] as string).split(",").map((s) => s.trim()),
    body: m[2] as string,
  }));
}

function baseRules(css: string): Rule[] {
  return rulesOf(blockBody(css, BASE_OPEN));
}

describe("compiled.css base layer", () => {
  it("the shipped CSS sets border-box", () => {
    for (const [label, css] of [["fresh", freshCss], ["committed", committedCss]] as const) {
      const rule = baseRules(css).find((r) => r.selectors.includes("*"));
      expect(rule, `${label}: rule on *`).toBeDefined();
      expect(rule?.selectors, label).toEqual(expect.arrayContaining(["*", "::before", "::after"]));
      expect(rule?.body, label).toMatch(/box-sizing:\s*border-box;/);
    }
  });

  it("input, textarea and select inherit font-family", () => {
    for (const [label, css] of [["fresh", freshCss], ["committed", committedCss]] as const) {
      const rule = baseRules(css).find((r) => r.selectors.includes("input"));
      expect(rule, `${label}: form-control rule`).toBeDefined();
      expect(rule?.selectors, label).toEqual(expect.arrayContaining(["input", "textarea", "select", "button"]));
      expect(rule?.body, label).toMatch(/font:\s*inherit;/);
    }
  });

  it("the base layer precedes the utilities layer and carries no class rule", () => {
    for (const [label, css] of [["fresh", freshCss], ["committed", committedCss]] as const) {
      const baseAt = css.indexOf(BASE_OPEN);
      expect(baseAt, `${label}: base layer present`).toBeGreaterThanOrEqual(0);
      expect(baseAt, `${label}: base before compiled`).toBeLessThan(css.indexOf(COMPILED_OPEN));
      const rules = baseRules(css);
      expect(rules.length, label).toBeGreaterThan(0);
      for (const rule of rules) {
        for (const selector of rule.selectors) expect(selector, label).not.toContain(".");
      }
    }
  });
});
