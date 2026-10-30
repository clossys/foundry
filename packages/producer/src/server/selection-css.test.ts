import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import * as cssTree from "css-tree";
import ts from "typescript";
import { importShadcnAriaComponents, materializeShadcnComponent } from "../../../designer/src/importers/shadcn-aria-components.js";
import { selectionCss } from "./selection-css.js";
import { SHADCN_SELECTION_BASE_CSS, SHADCN_SELECTION_BASE_SOURCE } from "./selection-shadcn-base.js";

// Exercise the real source generator without rebuilding an unrelated package's dist.
vi.mock("./cells.js", () => ({ agentModule: async (agent: string, file: string) => {
  if (agent !== "designer" || file !== "compiled-css/generate.js") throw new Error("Unexpected compiler module");
  return import("../../../designer/src/compiled-css/generate.js");
} }));

const selectedTokens = {
  css: ":root { --primary: oklch(0.42 0.1 180); --primary-foreground: oklch(0.98 0 0); }",
  theme: "@theme inline { --color-primary: var(--primary); --color-primary-foreground: var(--primary-foreground); }",
};
function emittedClasses(css: string): Set<string> {
  const classes = new Set<string>();
  cssTree.walk(cssTree.parse(css), node => { if (node.type === "ClassSelector") classes.add(cssTree.ident.decode(node.name)); });
  return classes;
}

function declarations(css: string, selector: string): Map<string, string> {
  const values = new Map<string, string>();
  cssTree.walk(cssTree.parse(css), node => {
    if (node.type !== "Rule" || node.prelude.type !== "SelectorList") return;
    const matches = selector === ":root" ? cssTree.generate(node.prelude).includes(":root") : (() => {
      let found = false;
      cssTree.walk(node.prelude, child => { if (child.type === "ClassSelector" && cssTree.ident.decode(child.name) === selector) found = true; });
      return found;
    })();
    if (matches) node.block.children.forEach(child => { if (child.type === "Declaration") values.set(child.property, cssTree.generate(child.value).trim()); });
  });
  return values;
}

/** Inventory class-bearing syntax independently of Tailwind's scanner or recognition. */
function usedClasses(files: ReadonlyMap<string, string>): Set<string> {
  const classes = new Set<string>();
  for (const [name, content] of files) {
    const source = ts.createSourceFile(name, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const declarations = new Map<string, ts.Expression>();
    const index = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) declarations.set(node.name.text, node.initializer);
      ts.forEachChild(node, index);
    };
    index(source);
    const collect = (node: ts.Node, seen = new Set<string>()): void => {
      if (ts.isStringLiteralLike(node)) node.text.split(/\s+/).filter(Boolean).forEach(candidate => classes.add(candidate));
      else if (ts.isIdentifier(node)) {
        const value = declarations.get(node.text);
        if (value && !seen.has(node.text)) collect(value, new Set([...seen, node.text]));
      } else if (ts.isConditionalExpression(node)) { collect(node.whenTrue, seen); collect(node.whenFalse, seen); }
      else if (ts.isBinaryExpression(node)) {
        if (node.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) collect(node.left, seen);
        collect(node.right, seen);
      } else if (ts.isPropertyAssignment(node)) {
        if (node.name.getText(source) !== "defaultVariants") collect(node.initializer, seen);
      } else if (ts.isElementAccessExpression(node) || ts.isPropertyAccessExpression(node)) collect(node.expression, seen);
      else if (!ts.isCallExpression(node)) ts.forEachChild(node, child => collect(child, seen));
    };
    const visit = (node: ts.Node): void => {
      if (ts.isJsxAttribute(node) && node.name.getText(source) === "className" && node.initializer) collect(node.initializer);
      if (ts.isCallExpression(node) && /^(?:cn|clsx|cva|tv|twMerge)$/.test(node.expression.getText(source))) node.arguments.forEach(argument => collect(argument));
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return classes;
}

describe("selected runtime CSS closure", () => {
  it("natively compiles selected shadcn utilities, variants and arbitrary classes against consumer tokens", async () => {
    const classes = ["rounded-md", "bg-primary", "h-9", "px-3", "text-sm", "shadow-xs", "transition-all", "hover:bg-primary/90", "data-[selected=true]:bg-primary", "[&_svg]:size-4", "w-[137px]", "translate-x-[calc(100%+2px)]"];
    const files = new Map([["components/.selected/Button.tsx", `export const Button = () => <button className='${classes.join(" ")}' />;`]]);
    const css = await selectionCss(files, undefined, selectedTokens);
    const emitted = emittedClasses(css);
    expect(classes.filter(candidate => !emitted.has(candidate))).toEqual([]);
    expect(css).toContain("--spacing: 0.25rem;");
    expect(css).toContain("--radius-md: 0.375rem;");
    expect(css).toContain("--default-transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);");
    expect(css).toContain("--default-transition-duration: 150ms;");
    expect(css).toContain("height: calc(var(--spacing) * 9)");
    expect(css).toContain("var(--default-transition-timing-function)");
    expect(css).toContain("background-color: var(--primary)");
    expect(css).toContain("width: 137px");
    expect(css).toContain(selectedTokens.css);
    expect(css).toContain("box-sizing: border-box");
    expect(css).toContain("--color-surface-base:");
    expect(css).not.toContain("@source");
    expect(/^\s*@theme\b/m.test(css)).toBe(false);
    expect(css).not.toContain("components/.selected/Button.tsx");
    const root = declarations(css, ":root");
    expect(declarations(css, "h-9").get("height")?.replace("var(--spacing)", root.get("--spacing")!)).toBe("calc(0.25rem*9)");
    expect(declarations(css, "bg-primary").get("background-color")?.replace("var(--primary)", root.get("--primary")!)).toBe("oklch(0.42 0.1 180)");
    expect(root.get("--default-transition-timing-function")?.replace(/\s+/g, "")).toBe("cubic-bezier(0.4,0,0.2,1)");
  });

  it("has zero missing native utility rules across actual materialized selected shadcn sources", async () => {
    const fixture = new URL("../../../designer/src/importers/__fixtures__/shadcn-aria/", import.meta.url);
    const read = (name: string) => readFileSync(new URL(name, fixture), "utf8");
    const imported = importShadcnAriaComponents({
      items: readdirSync(fixture).filter(name => name.endsWith(".json")).map(name => JSON.parse(read(name))).filter(item => item.type === "registry:ui"),
      styles: { path: "apps/v4/registry/styles/style-nova.css", content: read("style-nova.css") },
      notice: { path: "LICENSE.md", content: read("LICENSE.md") },
    });
    const files = new Map(["button", "card", "badge", "tabs", "dropdown-menu", "separator"].flatMap(item => materializeShadcnComponent(imported, item).map(file => [file.path, file.content] as const)));
    const expected = [...usedClasses(files)].sort();
    expect(expected.length).toBeGreaterThan(50);
    const css = await selectionCss(files, undefined, selectedTokens);
    const emitted = emittedClasses(css);
    // These source markers have no descendant selectors in this selected closure.
    // Report them explicitly; they are not utility classes and are not counted as covered.
    const unusedStructural = expected.filter(candidate => /^(?:group|peer)(?:\/|$)/.test(candidate) && !emitted.has(candidate));
    expect(unusedStructural).toEqual(["group/badge", "group/button", "group/card-header"]);
    const missing = expected.filter(candidate => !emitted.has(candidate) && !unusedStructural.includes(candidate));
    console.info(JSON.stringify({ used: expected.length, covered: expected.length - unusedStructural.length - missing.length, unusedStructural, missing }));
    expect(missing).toEqual([]);
    expect(css).toContain("scrollbar-width: none");
  });

  it("natively compiles only the pinned upstream scrollbar utility and keeps unknown used classes visible", async () => {
    expect(createHash("sha256").update(SHADCN_SELECTION_BASE_CSS).digest("hex")).toBe(SHADCN_SELECTION_BASE_SOURCE.utilitySha256);
    const files = new Map([["selected.tsx", 'const style = tv({ base: "h-9", variants: { tone: { strong: "unknown-tone" } }, defaultVariants: { tone: "strong" } }); export const View = () => <div className={cn("unknown-style no-scrollbar", true && "unknown-conditional")} />;']]);
    const css = await selectionCss(files, undefined, selectedTokens);
    const used = [...usedClasses(files)].sort();
    expect(used).toEqual(["h-9", "no-scrollbar", "unknown-conditional", "unknown-style", "unknown-tone"]);
    const emitted = emittedClasses(css);
    expect(used.filter(candidate => !emitted.has(candidate))).toEqual(["unknown-conditional", "unknown-style", "unknown-tone"]);
    expect(css).toContain("scrollbar-width: none");
    expect(css).toContain("::-webkit-scrollbar");
  });

  it("natively limits rules to selected contents and preserves consumer CSS and deterministic output", async () => {
    const files = new Map([["selected.tsx", 'export const View = () => <div className="h-[47px] bg-primary" />;'], ["selected.css", ".selected-proof { isolation: isolate; }"]]);
    const first = await selectionCss(files, undefined, selectedTokens);
    expect(first).toBe(await selectionCss(new Map([...files].reverse()), undefined, selectedTokens));
    const other = await selectionCss(new Map([["other.tsx", 'export const Other = () => <div className="h-[53px]" />;']]), undefined, selectedTokens);
    expect(first).toContain("height: 47px");
    expect(first).not.toContain("height: 53px");
    expect(other).toContain("height: 53px");
    expect(other).not.toContain("height: 47px");
    expect(first).toContain(files.get("selected.css"));
    const secondTokens = { ...selectedTokens, css: selectedTokens.css.replace("0.42", "0.62") };
    const changed = await selectionCss(files, undefined, secondTokens);
    expect(changed).not.toBe(first);
    expect(changed).toContain(secondTokens.css);
  });

  it("keeps existing native Designer utility roles live when the selected theme has a colliding namespace", async () => {
    const consumer = {
      css: ":root { --color-action: oklch(0.4 0.1 180); --color-accent: oklch(0.5 0.1 180); --accent: oklch(0.9 0.01 180); --text-sm: 19px; }",
      theme: "@theme inline { --color-accent: var(--accent); }",
    };
    const css = await selectionCss(new Map([["selected.tsx", 'export const View = () => <div className="bg-(--color-action) text-sm" />;']]), undefined, consumer);
    expect(declarations(css, "bg-accent").get("background-color")).toContain("var(--color-accent,");
    expect(declarations(css, "bg-accent").get("background-color")).not.toContain("var(--accent)");
    const root = declarations(css, ":root");
    expect(declarations(css, "bg-(--color-action)").get("background-color")?.replace("var(--color-action)", root.get("--color-action")!)).toBe("oklch(0.4 0.1 180)");
    expect(declarations(css, "text-sm").get("font-size")?.replace("var(--text-sm)", root.get("--text-sm")!)).toBe("19px");
  });

  it("compiles actual selected source variants, arbitrary values and single-quoted classes", async () => {
    const css = await selectionCss(new Map([
      ["components/selected/Selected.tsx", "export const Selected = () => <div className='w-[137px] hover:opacity-75 [&_span]:font-bold translate-x-[calc(100%+2px)]'>Selected<span>Label</span></div>;"],
      ["components/selected/classes.ts", "export const height = `h-[43px]`;"],
    ]));
    expect(css.includes("width: 137px")).toBe(true);
    expect(css.includes("opacity: 75%")).toBe(true);
    expect(css.includes("height: 43px")).toBe(true);
    expect(css.includes("\\:font-bold span {")).toBe(true);
    expect(css.includes("calc(100% + 2px)")).toBe(true);
    expect(css.includes("box-sizing: border-box")).toBe(true);
    expect(css.includes("--color-surface-base:")).toBe(true);
    expect(css.includes("components/selected/Selected.tsx")).toBe(false);
    const { chromium } = createRequire(import.meta.url)("playwright");
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.setContent('<html data-brand-bound=""><body><div id="selected" class="w-[137px] [&_span]:font-bold"><span>Selected</span></div></body></html>');
      expect(await page.locator("#selected").evaluate((element: HTMLElement) => getComputedStyle(element).width)).not.toBe("137px");
      await page.addStyleTag({ content: css });
      expect(await page.locator("#selected").evaluate((element: HTMLElement) => getComputedStyle(element).width)).toBe("137px");
      expect(await page.locator("#selected span").evaluate((element: HTMLElement) => getComputedStyle(element).fontWeight)).toBe("700");
    } finally { await browser.close(); }
  });

  it("keeps Designer's responsive variants winning over base utilities the selected layer re-emits", async () => {
    // A selected component uses `flex-col`; a Designer package section ships `flex-col tablet:flex-row`.
    const css = await selectionCss(new Map([["components/selected/Card.tsx", 'export const Card = () => <div className="flex flex-col" />;']]));
    // The selected layer is the last utility layer: when it re-emits `flex-col`, the variant must follow it there.
    const selected = css.slice(css.indexOf("@layer foundry-ui-selected {"));
    const base = selected.indexOf(".flex-col {");
    const variant = selected.indexOf(".tablet\\:flex-row {");
    expect(base).toBeGreaterThan(0);
    expect(variant).toBeGreaterThan(base);
    expect(selected.slice(0, variant)).toContain("@media (width >= 768px)");
  });

  it("does not invent a selected utility rule without its candidate and preserves emitted CSS", async () => {
    const css = await selectionCss(new Map([["selected.ts", "export const label = 'Selected';"], ["selected.css", ".selected-proof { isolation: isolate; }"]]));
    expect(css.includes("width: 137px")).toBe(false);
    expect(css.includes(".selected-proof { isolation: isolate; }")).toBe(true);
    expect(css.includes(".m-0 {")).toBe(true);
    expect(css.includes(".font-body {")).toBe(true);
  });
});
