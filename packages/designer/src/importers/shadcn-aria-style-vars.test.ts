import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import adapter from "../catalog/adapters/shadcn@aria.json" with { type: "json" };
import railBindings from "./rail-token-bindings.json" with { type: "json" };
import { importShadcnAriaComponents, type ShadcnComponentInput } from "./shadcn-aria-components.js";
import { importShadcnAriaRail } from "./shadcn-aria-rail.js";
import { EMITTED_PROPERTIES } from "./rewrite.js";
import { SHADCN_ARIA_STOCK_UTILITIES, isShadcnAriaStockUtility } from "./shadcn-aria-style-vars.js";
import type { SourceFile } from "./rewrite.js";

const fixtures = resolve(import.meta.dirname, "__fixtures__/shadcn-aria");
const fillsDir = resolve(import.meta.dirname, "../catalog/fills/shadcn@aria");

/** Class atom without its variant prefix (the last `:` outside brackets/parens). */
function base(atom: string): string {
  let depth = 0;
  let cut = 0;
  for (let i = 0; i < atom.length; i++) {
    const ch = atom[i];
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    else if (ch === ":" && depth === 0) cut = i + 1;
  }
  return atom.slice(cut).replace(/^!/, "");
}

function pinnedInput(): ShadcnComponentInput {
  const read = (name: string) => readFileSync(resolve(fixtures, name), "utf8");
  return { items: readdirSync(fixtures).filter(name => name.endsWith(".json")).map(name => JSON.parse(read(name))).filter(item => item.type === "registry:ui"),
    styles: { path: "apps/v4/registry/styles/style-nova.css", content: read("style-nova.css") }, notice: { path: "LICENSE.md", content: read("LICENSE.md") } };
}

/** Every shadcn@aria adopted file (components and rail), each matched to the adopted fill that pins its digest. */
function adoptedFiles(): { item: string; file: SourceFile }[] {
  const components = importShadcnAriaComponents(pinnedInput());
  const rail = importShadcnAriaRail();
  // Adopted fill digests, by the slot that adopts them; every one must be produced by exactly the rewrite run here.
  const adopted = new Map<string, string>();
  for (const name of readdirSync(fillsDir).filter(name => name.endsWith(".json") && name !== "components.coverage.json")) {
    const doc = JSON.parse(readFileSync(resolve(fillsDir, name), "utf8")) as { components: Record<string, { outputSha256: { path: string; sha256: string }[] }> };
    for (const [leaf, component] of Object.entries(doc.components)) adopted.set(JSON.stringify(component.outputSha256), leaf);
  }
  const rows: { item: string; file: SourceFile }[] = [];
  const matched = new Set<string>();
  for (const [item, rewrite] of [...Object.entries(components.rewrites), ...Object.entries(rail.rewrites)]) {
    const digest = JSON.stringify(rewrite.outputSha256);
    if (!adopted.has(digest)) continue;
    matched.add(digest);
    for (const file of rewrite.files.filter(file => /\.(?:tsx?|css)$/.test(file.path))) rows.push({ item: `${adopted.get(digest)} (${item})`, file });
  }
  // A composed leaf ships the rewritten stock bytes beside Foundry-owned wiring (U-K4-own, not adopted bytes): each
  // stock file must carry the digest its fill records.
  const composed = new Set(components.composed.flatMap(doc => Object.keys(doc.components)));
  for (const [digest, leaf] of adopted) {
    if (matched.has(digest) || !composed.has(leaf)) continue;
    const stock = components.composedFiles[leaf] ?? [];
    const recorded = new Map((JSON.parse(digest) as { path: string; sha256: string }[]).map(row => [row.path, row.sha256]));
    for (const file of stock) expect(recorded.get(file.path), `${leaf} ${file.path} adopted digest`).toBe(createHash("sha256").update(file.content).digest("hex"));
    matched.add(digest);
    for (const file of stock.filter(file => /\.(?:tsx?|css)$/.test(file.path))) rows.push({ item: `${leaf} (composed stock)`, file });
  }
  expect([...adopted].filter(([digest]) => !matched.has(digest)).map(([, leaf]) => leaf), "adopted fills not reproduced by the rewrite").toEqual([]);
  expect(new Set(rows.map(row => row.item)).size).toBeGreaterThan(25);
  return rows;
}

/** Custom properties a file defines itself (class `[--x:…]`, style key `"--x":`, CSS `--x:`). */
const defined = (code: string): Set<string> =>
  new Set([...code.matchAll(/(?:^|[[{;,\s"'])(--[a-zA-Z][\w-]*)["']?\]?\s*:/gm)].map(match => match[1]!));

/**
 * The only non-emitted properties an adopted byte may still read, each named by the residual it stands for:
 * R-T the stock `text-*` type scale (adapter `fontSizes`); R-W the sidebar widths the rail sets at runtime (rail
 * variables, no consumer source); R-U the upstream runtime reads no consumer member emits, unchanged from base (nova
 * combobox `--available-height`, the rail mobile hook's `--breakpoint-mobile-lg`); RAC the geometry React Aria
 * Components itself sets.
 */
const RESIDUALS: Readonly<Record<string, ReadonlySet<string>>> = {
  "R-T": new Set(Object.values(adapter.fontSizes)),
  "R-W": new Set(railBindings.variables.map(row => row.property)),
  "R-U": new Set(["--available-height", "--breakpoint-mobile-lg"]),
  "RAC": new Set(["--trigger-width", "--trigger-anchor-point", "--disclosure-panel-height", "--disclosure-panel-width", "--tab-panel-width", "--tab-panel-height",
    "--visual-viewport-width", "--visual-viewport-height", "--page-width", "--page-height"]),
};

describe("shadcn@aria adopted bytes (target state)", () => {
  it("read only consumer-emitted properties, local definitions and the named residuals", () => {
    const outside: string[] = [];
    const residual: Record<string, Set<string>> = {};
    for (const { item, file } of adoptedFiles()) {
      const local = defined(file.content);
      for (const [property] of file.content.matchAll(/--[a-zA-Z][\w-]*/g)) {
        if (EMITTED_PROPERTIES.has(property) || local.has(property)) continue;
        const label = Object.entries(RESIDUALS).find(([, set]) => set.has(property))?.[0];
        if (label) (residual[label] ??= new Set()).add(property);
        else outside.push(`${item} ${file.path}: ${property}`);
      }
    }
    expect([...new Set(outside)]).toEqual([]);
    expect([...residual["R-W"] ?? []].sort()).toEqual(["--ui-layout-sidebar-rail-w", "--ui-layout-sidebar-w"]);
    expect([...residual["R-U"] ?? []].sort()).toEqual(["--available-height", "--breakpoint-mobile-lg"]);
    for (const property of residual["R-T"] ?? []) expect(property).toMatch(/^--text-/);
  });

  it("introduces no Foundry-only stacking, timing, opacity, ring, border or focus-offset property", () => {
    const foundryOnly = /--ui-(?:z|duration|ease|alpha|border|focus|ring)-?[\w-]*|--ease-default|--opacity-[\w-]+/g;
    const hits = adoptedFiles().flatMap(({ item, file }) => [...file.content.matchAll(foundryOnly)].map(match => `${item} ${file.path}: ${match[0]}`));
    expect(hits).toEqual([]);
  });

  it("keeps every stock nova stacking, timing, opacity, weight, transition and border-width utility unchanged", () => {
    const atoms = adoptedFiles().flatMap(({ file }) => file.content.split(/[\s"'`{},]+/).map(base));
    const seen = Object.fromEntries(Object.entries(SHADCN_ARIA_STOCK_UTILITIES).map(([label, pattern]) => [label, atoms.some(atom => pattern.test(atom))]));
    expect(seen).toEqual(Object.fromEntries(Object.keys(SHADCN_ARIA_STOCK_UTILITIES).map(label => [label, true])));
    for (const stock of ["z-50", "duration-100", "duration-200", "ease-linear", "opacity-50", "border"]) expect(atoms, stock).toContain(stock);
    expect(isShadcnAriaStockUtility("z-50")).toBe(true);
    expect(isShadcnAriaStockUtility("z-(--ui-z-overlay)")).toBe(false);
  });
});
