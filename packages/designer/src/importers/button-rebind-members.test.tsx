import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import componentSlots from "../catalog/slots/components.json" with { type: "json" };
import { loadCatalogBundles } from "../catalog-bundles.js";
import { emitComponents } from "../catalog-core/emit-components.js";
import { componentDescriptorHash } from "../catalog-core/resolve-components.js";
import type { ComponentCandidateDocument, ComponentFile, ResolvedComponent, ResolvedComponents } from "../catalog-core/resolve-components.js";
import { Icon as PackageIcon } from "../components/index.js";
import { selectedRuntime } from "./__fixtures__/selected-runtime.js";

/**
 * A shadcn@aria source that imports Button is rebound to the consumer's Button leaf, whose emitted
 * entrypoint dispatches Foundry members and throws on anything else. Every Button prop literal the
 * materialized sources pass must therefore be a member that dispatcher declares, and the persisted
 * Dialog (whose close button passes one) must render through the real dispatcher.
 */
const bundles = loadCatalogBundles();
const fillId = (doc: ComponentCandidateDocument): string => doc.$extensions["com.clossys.fill"].id;
const slotOf = (doc: ComponentCandidateDocument): string => Object.values(doc.components)[0]!.slot;
const shadcn = bundles.componentFills.filter(doc => doc.$extensions["com.clossys.fill"].source === "shadcn@aria");
const materialized = new Map(bundles.sourceBundles.map(bundle => [bundle.slot, bundle.files]));
const bySlot = (slot: string): ComponentCandidateDocument => shadcn.find(doc => slotOf(doc) === slot)!;
const icon = bundles.componentFills.find(doc => fillId(doc) === "foundry/components.icon")!;

// Package inventories are read from the real barrels; third-party named imports are admitted as written.
const barrel = (subpath: string): string[] => [...readFileSync(resolve(import.meta.dirname, `../${subpath}/index.ts`), "utf8").matchAll(/export\s*\{([^}]+)\}/g)]
  .flatMap(match => match[1]!.split(",").map(binding => binding.trim().replace(/^type\s+/, "").split(/\s+as\s+/).at(-1)!)).filter(Boolean);
function packageExports(files: readonly ComponentFile[]): Record<string, string[]> {
  const exports: Record<string, Set<string>> = {};
  for (const file of files) for (const match of file.content.matchAll(/\bimport\s+(?:type\s+)?\{([^}]+)\}\s*from\s*["']([^"'.][^"']*)["']/g)) {
    const names = exports[match[2]!] ??= new Set();
    for (const binding of match[1]!.split(",")) { const name = binding.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]; if (name) names.add(name); }
  }
  return { ...Object.fromEntries(Object.entries(exports).map(([module, names]) => [module, [...names].sort()])), "@clossys/designer/components": barrel("components") };
}

function persist(docs: readonly ComponentCandidateDocument[]): ComponentFile[] {
  const files = new Map<string, ComponentFile>();
  for (const doc of docs) for (const file of materialized.get(slotOf(doc)) ?? []) files.set(file.path, file);
  const owned = [...files.values()];
  const resolved = (doc: ComponentCandidateDocument): ResolvedComponent => {
    const descriptor = Object.values(doc.components)[0]!;
    return {
      slot: descriptor.slot, originKind: "adopted",
      origin: { kind: "adopted", source: descriptor.source, fill: fillId(doc), pin: descriptor.pin, license: descriptor.license ?? "MIT", sha256: componentDescriptorHash(descriptor), adoptedAt: "2026-01-01T00:00:00.000Z" },
      impl: descriptor.impl as ResolvedComponent["impl"], propMap: structuredClone(descriptor.propMap),
      reads: { tokens: {}, assets: [...descriptor.reads.assets], components: [...descriptor.reads.components] }, descriptor,
    };
  };
  const profile: ResolvedComponents = {
    consumer: "button-rebind", selectionHash: `sha256:${"0".repeat(64)}`,
    components: Object.fromEntries(docs.map(doc => [slotOf(doc), resolved(doc)])), files: owned,
    check: { ok: true, findings: [] } as unknown as ResolvedComponents["check"],
    packageExports: packageExports(owned),
  };
  const glyphs = Object.fromEntries(docs.flatMap(doc => Object.values(doc.components)[0]!.reads.assets).map(asset => [asset, [["path", { d: "M4 12h16" }]]]));
  return emitComponents(profile, ["component-index"], { glyphModule: { path: "assets/glyphs.ts", glyphs } });
}

/** The emitted Button entrypoint's dispatch table, read from the real persisted bytes. */
function dispatchTable(files: readonly ComponentFile[]): Record<string, Record<string, unknown>> {
  const entry = files.find(file => file.path === "components/button/index.ts")!.content;
  const table = /const mappings: [^=]+= (\{[\s\S]*?\});\nexport const Button\b/.exec(entry);
  if (!table) throw new Error("Button entrypoint has no dispatch table");
  return JSON.parse(table[1]!) as Record<string, Record<string, unknown>>;
}

const BUTTON_IMPORT = /\bimport\s*\{\s*Button\s*\}\s*from\s*"(?:\.\.\/)+button\/index(?:\.js)?"/;
/** One JSX opening tag of `name`, scanned to its closing `>` at brace depth zero. */
function openingTags(content: string, name: string): string[] {
  const tags: string[] = [];
  for (const match of content.matchAll(new RegExp(`<${name}\\b`, "g"))) {
    let depth = 0, index = match.index + match[0].length, quote = "";
    for (; index < content.length; index++) {
      const char = content[index]!;
      if (quote) { if (char === quote) quote = ""; continue; }
      if (char === '"' || char === "'") quote = char;
      else if (char === "{") depth++;
      else if (char === "}") depth--;
      else if (char === ">" && depth === 0) break;
    }
    tags.push(content.slice(match.index, index + 1));
  }
  return tags;
}
/** Functions whose props are the rebound Button's own props (optionally Omit-ted), and the axes they keep. */
function buttonShaped(content: string): Map<string, { body: string; omitted: string[] }> {
  const wrappers = new Map<string, { body: string; omitted: string[] }>();
  const starts = [...content.matchAll(/^function ([A-Z][A-Za-z0-9]*)\(\{/gm)];
  starts.forEach((start, index) => {
    const body = content.slice(start.index, starts[index + 1]?.index ?? content.length);
    const props = /^function [A-Za-z0-9]+\(\{[^}]*\}:\s*(Omit<)?(?:React\.|React)?ComponentProps<typeof Button>(?:,\s*((?:"[a-z]+"\s*\|?\s*)+)>)?/.exec(body);
    if (props && start[1] !== "Button") wrappers.set(start[1]!, { body, omitted: [...(props[2] ?? "").matchAll(/"([a-z]+)"/g)].map(match => match[1]!) });
  });
  return wrappers;
}
/** Every literal value a materialized source passes, or defaults, on a rebound Button axis. */
function buttonLiterals(files: readonly ComponentFile[], axes: readonly string[]): string[] {
  const wrappers = new Map<string, { body: string; omitted: string[] }>();
  const rebound = files.filter(file => BUTTON_IMPORT.test(file.content));
  for (const file of rebound) for (const [name, wrapper] of buttonShaped(file.content)) wrappers.set(name, wrapper);
  const found: string[] = [];
  for (const file of rebound) {
    for (const [name, kept] of [["Button", axes], ...[...wrappers].map(([wrapper, { omitted }]) => [wrapper, axes.filter(axis => !omitted.includes(axis))] as const)] as const) {
      for (const tag of openingTags(file.content, name)) for (const match of tag.matchAll(/(?<=\s)([a-z]+)="([^"]*)"/g)) {
        if (kept.includes(match[1]!)) found.push(`${file.path} <${name}> ${match[1]}=${match[2]}`);
      }
    }
    for (const [name, { body, omitted }] of buttonShaped(file.content)) {
      const destructured = /^function [A-Za-z0-9]+\(\{([^}]*)\}/.exec(body)![1]!;
      for (const match of destructured.matchAll(/\b([a-z]+) = "([^"]*)"/g)) {
        if (axes.includes(match[1]!) && !omitted.includes(match[1]!)) found.push(`${file.path} ${name}() ${match[1]}=${match[2]}`);
      }
    }
  }
  return found;
}

afterEach(cleanup);

describe("shadcn@aria sources speak the rebound Button's declared members", () => {
  const button = bySlot("components.button"), dialog = bySlot("components.dialog");
  const files = persist([button, dialog, icon]);
  const table = dispatchTable(files);

  it("dispatches only the Button slot's declared members", () => {
    const declared = (componentSlots as unknown as { id: string; contract: { members: { names: string[] } } }[]).find(slot => slot.id === "components.button")!.contract.members.names;
    expect(Object.entries(table).flatMap(([axis, choices]) => Object.keys(choices).map(value => `${axis}.${value}`)).filter(member => !declared.includes(member))).toEqual([]);
    expect(Object.keys(table.size!).sort()).toEqual(["lg", "md", "sm"]);
    expect(Object.keys(table.shape!)).toContain("icon-only");
  });

  it("every Button axis literal any materialized fill emits is a member the dispatcher declares", () => {
    const sources = shadcn.flatMap(doc => materialized.get(slotOf(doc)) ?? []);
    const literals = buttonLiterals(sources, Object.keys(table));
    // Dialog and combo-box both rebind Button and pass literals; an empty scan would prove nothing.
    expect(literals.some(literal => literal.startsWith("components/dialog/"))).toBe(true);
    expect(literals.some(literal => literal.startsWith("components/combo-box/"))).toBe(true);
    const undeclared = literals.filter(literal => {
      const [, axis, value] = /([a-z]+)=([^=]*)$/.exec(literal)!;
      return !Object.hasOwn(table[axis!]!, value!);
    });
    expect(undeclared).toEqual([]);
  });

  it("renders the persisted Dialog, its close button and DialogClose through the real Button dispatcher", () => {
    // The package Icon primitive is the real source export; its built entry has top-level await, which
    // the synchronous selected loader cannot require, so it crosses through one named module instead.
    (globalThis as { __selectedPackageIcon?: unknown }).__selectedPackageIcon = PackageIcon;
    const designer = { path: "packages/designer-components.ts", content: "export const Icon = (globalThis as { __selectedPackageIcon?: unknown }).__selectedPackageIcon;\n" };
    const runtime = selectedRuntime([...files, designer], { "@clossys/designer/components": designer.path });
    const module = runtime.load("components/dialog/dialog.tsx") as Record<string, React.ComponentType<Record<string, unknown>>>;
    const { Dialog, DialogClose, DialogFooter } = module as Record<string, React.ComponentType<any>>;
    expect(() => render(<DialogClose>Done</DialogClose>)).not.toThrow();
    expect(screen.getByRole("button", { name: "Done" }).getAttribute("data-size")).toBe("default");
    cleanup();
    expect(() => render(<DialogFooter showCloseButton>Body</DialogFooter>)).not.toThrow();
    expect(screen.getByRole("button", { name: "Close" }).getAttribute("data-variant")).toBe("outline");
    cleanup();
    expect(() => render(<Dialog isOpen aria-label="Example">Body</Dialog>)).not.toThrow();
    const close = screen.getByRole("button", { name: "Close" });
    // The upstream icon-sm close button keeps the declared square member, not a text size.
    expect(close.getAttribute("data-size")).toBe("icon");
    expect(close.getAttribute("data-variant")).toBe("ghost");
  });
});
