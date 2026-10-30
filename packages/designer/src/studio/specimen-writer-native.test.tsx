import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as react from "react";
import * as reactAriaComponents from "react-aria-components";
import * as clsx from "clsx";
import * as classVarianceAuthority from "class-variance-authority";
import * as tailwindMerge from "tailwind-merge";
import * as components from "../components/index.js";
import * as blocks from "../blocks/index.js";
import * as studio from "./index.js";
import { loadCatalog, loadComponentRegistry, loadSectionRegistry } from "../catalog-core/index.js";
import { applyLibraryChange, libraryHash } from "../catalog-core/api.js";
import { resolveComposite } from "../catalog-core/library-components.js";
import { componentOf } from "../catalog-core/resolve-components.js";
import { emitComponents } from "../catalog-core/emit-components.js";
import { completedCatalogLibrary } from "../catalog-core/__fixtures__/completed-catalog-library.js";
import { selectedPackageComponentOptions } from "../catalog-core/__fixtures__/surface-engine/selected-package-closure.js";
import { importFoundrySections } from "../importers/foundry-sections.js";
import { writerSpecimenPackageFill } from "../importers/specimen-sections.js";
import { readSurfacePackageEvidence } from "../library-cli/surface-package-evidence.js";
import { loadCatalogBundles } from "../catalog-bundles.js";
import type { CompositeCatalogData, CompositeLibraryData } from "../catalog-core/types.js";
import type { DesignerSpecimenContext } from "./DesignerSpecimen.js";
import { emittedDesignerSpecimenContext, bindNativeSpecimenContext } from "./emitted-specimens.js";
import { contentSpecimenNeeds, SpecimenCopyInContext, type CopyInContextValue } from "./specimen-content.js";
import { projectAgentSpecimenPlan } from "./specimen-plan.js";
import { specimenComponent, type SpecimenAxis, type SpecimenItem, type SpecimenLeafProps } from "./specimen-layouts.js";

/** Execute adopted source bytes with the same React Aria peer instance as the package leaves. */
function nativeSourceModule(files: readonly { path: string; content: string }[], entry: string): Record<string, unknown> {
  const code = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { readFileSync } from "node:fs";
    import { posix } from "node:path";
    import { build } from "esbuild";
    const data = JSON.parse(readFileSync(0, "utf8"));
    const files = new Map(data.files.map(file => [file.path, file.content]));
    const find = path => [path, path.replace(/\\.js$/, ".ts"), path.replace(/\\.js$/, ".tsx"), path + ".ts", path + ".tsx", path + "/index.ts"].find(candidate => files.has(candidate));
    const result = await build({ entryPoints: [data.entry], bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic", packages: "external", logLevel: "silent", plugins: [{
      name: "native-writer-source",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => {
          if (args.kind === "entry-point") return { path: args.path, namespace: "native" };
          if (!args.path.startsWith(".")) return { path: args.path, external: true };
          const path = find(posix.normalize(posix.join(posix.dirname(args.importer), args.path)));
          return path ? { path, namespace: "native" } : { errors: [{ text: "unresolved " + args.path }] };
        });
        builder.onLoad({ filter: /.*/, namespace: "native" }, args => ({ contents: files.get(args.path), loader: args.path.endsWith(".tsx") ? "tsx" : "ts" }));
      },
    }] });
    process.stdout.write(result.outputFiles[0].text);
  `], { input: JSON.stringify({ files, entry }), encoding: "utf8" });
  const module = { exports: {} as Record<string, unknown> }, host = createRequire(import.meta.url);
  const require = (specifier: string) => specifier === "react-aria-components" ? reactAriaComponents : specifier === "@clossys/designer/components" ? components : host(specifier);
  new Function("require", "exports", "module", code)(require, module.exports, module);
  return module.exports;
}

let context: DesignerSpecimenContext;
let emittedContext: DesignerSpecimenContext;
let emittedComponents: Readonly<Record<string, unknown>>;
let writerPackageEvidence: Awaited<ReturnType<typeof readSurfacePackageEvidence>>;
let writerPackageCatalog: CompositeCatalogData;
let writerPackageLibrary: CompositeLibraryData;
let writerPackageComponentOptions: ReturnType<typeof selectedPackageComponentOptions>;
const need: SpecimenLeafProps["need"] = value => <components.SemanticContent as="p" role="status">{value.leaf}: {value.reason}</components.SemanticContent>;
const labels = { showAllVariants: (count: number) => `Show all ${count}` };
const roles: readonly CopyInContextValue["role"][] = ["headline", "body", "cta", "nav", "error", "empty"];
const cases = (count: number) => {
  const items: SpecimenItem<CopyInContextValue>[] = Array.from({ length: count }, (_, index) => {
    const role = roles[index % roles.length]!, common = { context: `Page copy field ${index}`, locale: "en", dir: "ltr" as const };
    const value: CopyInContextValue = role === "body" ? { ...common, role, passage: "**Complete body**\n\nFinal paragraph remains visible." } : { ...common, role, text: `Native ${role} ${index}` };
    return { id: `field-${index}`, label: `Field ${index}`, value, coordinates: { field: `field-${index}`, role } };
  });
  const axes: SpecimenAxis[] = [{ id: "field", label: "Field", values: items.map(item => ({ id: item.id, label: item.label })) }, { id: "role", label: "Role", values: roles.map(role => ({ id: role, label: role })) }];
  return { items, axes };
};
const props = (count: number, selected = context): SpecimenLeafProps => ({ ...cases(count), context: selected, labels, need });
const visible = (root: Element, selector: string) => [...root.querySelectorAll(selector)].filter(node => !node.closest("[hidden]"));

beforeAll(async () => {
  const bundles = loadCatalogBundles(), valuesCatalog = loadCatalog();
  const imported = [...importFoundrySections().fills.filter(doc => ["sections.section-header", "sections.empty-state"].includes(doc.$extensions["com.clossys.fill"].slot)), writerSpecimenPackageFill()];
  const catalog: CompositeCatalogData = { values: valuesCatalog, components: { slots: loadComponentRegistry().slots, fills: bundles.componentFills }, surfaces: { slots: loadSectionRegistry().slots, fills: imported, transforms: [], rules: [], materializations: [] } };
  const values = completedCatalogLibrary(valuesCatalog, { id: "writer-native-consumer", kind: "consumer", author: "consumer", license: "MIT" }, "2026-10-30");
  const { source, adoptedAt, ...portion } = values;
  const empty: CompositeLibraryData = { source, adoptedAt, values: portion, components: { fills: [], files: [] } };
  const available = new Map<string, (typeof bundles.componentFills)[number]>();
  for (const doc of bundles.componentFills) {
    const fill = doc.$extensions["com.clossys.fill"];
    if (!available.has(fill.slot) || fill.source === "shadcn@aria") available.set(fill.slot, doc);
  }
  const ordered: string[] = [], visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    const doc = available.get(id);
    if (!doc) throw new Error(`Missing native Writer component ${id}`);
    visited.add(id);
    const component = componentOf(doc);
    for (const dependency of [...component.reads.components, ...component.composes]) visit(dependency);
    ordered.push(id);
  };
  for (const id of ["components.semantic-content", "components.rich-text", "components.grid-list", "components.table", "components.disclosure", "components.navigation-tree", "components.button"]) visit(id);
  const componentOptions = { packageExports: { ...selectedPackageComponentOptions().packageExports, react: Object.keys(react), "react-aria-components": Object.keys(reactAriaComponents), clsx: Object.keys(clsx), "class-variance-authority": Object.keys(classVarianceAuthority), "tailwind-merge": Object.keys(tailwindMerge) } };
  const library = applyLibraryChange(catalog, empty, { baseHash: libraryHash(empty), bundles: bundles.sourceBundles, changes: ordered.map(id => ({ portion: "components", change: { op: "adopt", slot: id, source: available.get(id)!.$extensions["com.clossys.fill"].source } })) }, { componentOptions });
  writerPackageEvidence = await readSurfacePackageEvidence(imported);
  const surfaceOptions = { packages: writerPackageEvidence, measurements: [] };
  const selected = applyLibraryChange(catalog, library, { baseHash: libraryHash(library), changes: imported.map(doc => ({ portion: "surfaces", change: { op: "adopt", slot: doc.$extensions["com.clossys.fill"].slot, source: "foundry" } })) }, { componentOptions, surfaceOptions });
  const profile = resolveComposite({ catalog, library: selected, componentOptions, surfaceOptions });
  writerPackageCatalog = catalog; writerPackageLibrary = selected; writerPackageComponentOptions = componentOptions;
  const glyphs = Object.fromEntries(Object.values(profile.values.members).filter(value => value.$type === "glyph").map(value => [value.slot, value.value.light]));
  const nativeFiles = emitComponents(profile.components, ["component-index"], { glyphModule: { path: "glyphs.ts", glyphs } });
  const tableEntry = profile.components.components["components.table"]!.impl;
  const disclosureEntry = profile.components.components["components.disclosure"]!.impl;
  if (tableEntry.kind !== "source" || disclosureEntry.kind !== "source") throw new Error("Native emitted table and disclosure sources are required.");
  const entry = { path: "native-runtime.ts", content: `export * as components from "./component-index";\nexport * as table from ${JSON.stringify("./" + tableEntry.entry)};\nexport * as disclosure from ${JSON.stringify("./" + disclosureEntry.entry)};\n` };
  const emitted = nativeSourceModule([...nativeFiles, entry], entry.path) as Record<string, Readonly<Record<string, unknown>>>;
  emittedComponents = emitted.components!;
  emittedContext = emittedDesignerSpecimenContext(profile, { components: emittedComponents, surfaces: { ...blocks, SpecimenCopyInContext: studio.SpecimenCopyInContext }, tree: { NavigationTree: emittedComponents.NavigationTree, NavigationTreeItem: components.NavigationTreeItem, NavigationTreeItemContent: components.NavigationTreeItemContent }, table: emitted.table, disclosure: { Disclosure: emittedComponents.Disclosure, AccordionItem: emitted.disclosure!.AccordionItem, AccordionTrigger: emitted.disclosure!.AccordionTrigger, AccordionContent: emitted.disclosure!.AccordionContent } });
  const modules: Record<string, Readonly<Record<string, unknown>>> = { "@clossys/designer/components": components };
  for (const component of Object.values(profile.components.components)) if (component.impl.kind === "source") modules[component.impl.entry] = nativeSourceModule(nativeFiles, component.impl.entry);
  context = { ...emittedDesignerSpecimenContext(profile, { components, surfaces: blocks }), modules };
}, 60_000);
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each([1, 6, 15])("renders %i native Writer fields with selected source leaves and intrinsic cardinality", count => {
  const errors = vi.spyOn(console, "error");
  for (const id of ["components.button", "components.table", "components.disclosure"]) expect(specimenComponent(context, id)).toMatchObject({ source: "shadcn@aria" });
  expect(contentSpecimenNeeds("sections.specimen-copy-in-context", props(count))).toEqual([]);
  const view = render(<SpecimenCopyInContext {...props(count)} />);
  expect(visible(view.container, "[data-copy-role]")).toHaveLength(1);
  expect(screen.getByRole("heading", { name: "Native headline 0" })).toBeVisible();
  if (count === 1) expect(view.container.querySelector("table,[role='grid'],button")).toBeNull();
  else {
    expect(screen.getAllByRole("columnheader")).toHaveLength(roles.length + 1);
    fireEvent.click(screen.getByRole("button", { name: `Show all ${count}` }));
    expect(visible(view.container, "[data-copy-role]")).toHaveLength(count);
    expect(screen.getAllByText("Final paragraph remains visible.")[0]).toBeVisible();
    expect(screen.getByRole("button", { name: "Native cta 2" })).toHaveAttribute("data-slot", "button");
    expect(view.container.querySelector("[data-copy-role='nav'] [data-ds-leaf='components.navigation-tree']")).toBeTruthy();
    for (const role of ["error", "empty"]) expect(view.container.querySelector(`[data-copy-role='${role}'] [data-ds-leaf='sections.empty-state']`)).toBeTruthy();
  }
  expect(view.container.querySelector("textarea,[contenteditable='true']")).toBeNull();
  expect(view.container.querySelector("[data-ds-specimen-need='true']")).toBeNull();
  view.rerender(<SpecimenCopyInContext {...props(count)} expanded />);
  expect(view.container.querySelectorAll("[data-ds-specimen-item]")).toHaveLength(count);
  expect(screen.queryByRole("button", { name: `Show all ${count}` })).toBeNull();
  expect(errors).not.toHaveBeenCalled();
});

it("refuses absent selected source and stale surfaces before rendering any Writer fields", () => {
  const button = context.profile.components.components["components.button"]!;
  if (button.impl.kind !== "source") throw new Error("The selected CTA must be native source.");
  const modules = { ...context.modules };
  delete modules[button.impl.entry];
  const view = render(<SpecimenCopyInContext {...props(6, { ...context, modules })} />);
  expect(screen.getByRole("status")).toHaveTextContent("module-unavailable");
  expect(view.container.querySelector("[data-copy-role]")).toBeNull();
  const heading = context.surfaces!["sections.section-header"]!;
  view.rerender(<SpecimenCopyInContext {...props(1, { ...context, surfaces: { ...context.surfaces, "sections.section-header": { ...heading, descriptorHash: "stale" } } })} />);
  expect(screen.getByRole("status")).toHaveTextContent("descriptor-matched");
  expect(screen.queryByRole("heading")).toBeNull();
});

it("renders a complete structured native body through the source-plan adapter and read-only RichText", () => {
  const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
  const passage = { type: "doc", content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Native narrative heading" }] },
    paragraph("Complete passage wording."),
    { type: "bulletList", content: [{ type: "listItem", content: [paragraph("Native list wording.")] }] },
    { type: "blockquote", content: [paragraph("Native quote wording.")] },
    { type: "callout", content: [paragraph("Native callout wording.")] },
    { type: "codeBlock", content: [{ type: "text", text: "native example" }] },
  ] };
  const errors = vi.spyOn(console, "error");
  const projected = projectAgentSpecimenPlan({ agent: "writer", plan: { cellId: "narrative", items: [{ id: "native-body", kind: "writer", role: "body", context: "Native narrative", locale: "en", value: passage }], expectedVariantIds: ["native-body"], issues: [] } });
  expect(projected.issues).toEqual([]);
  const input = { items: projected.cell.items, context, labels, need };
  expect(contentSpecimenNeeds("sections.specimen-copy-in-context", input)).toEqual([]);
  const view = render(<SpecimenCopyInContext {...input} />);
  expect(screen.getByRole("heading", { name: "Native narrative heading" })).toHaveProperty("tagName", "H2");
  expect(screen.getByRole("list")).toHaveTextContent("Native list wording.");
  expect(view.container.querySelector("blockquote")).toHaveTextContent("Native quote wording.");
  expect(view.container.querySelector("[data-slot='rich-text-callout']")).toHaveTextContent("Native callout wording.");
  expect(view.container.querySelector("pre code")).toHaveTextContent("native example");
  expect(view.container.querySelector("[data-readonly='true']")).toBeTruthy();
  expect(view.container.querySelector("textarea,[contenteditable='true']")).toBeNull();
  expect(errors).not.toHaveBeenCalled();
});

it("fails zero fields, malformed roles and incomplete matrix coordinates with the native selection", () => {
  for (const input of [props(0), { ...props(1), items: [{ id: "unknown", label: "Unknown", value: { role: "unknown", text: "Copy", context: "Field", locale: "en", dir: "ltr" } }] }, { ...props(6), axes: [] }]) {
    expect(contentSpecimenNeeds("sections.specimen-copy-in-context", input).length).toBeGreaterThan(0);
    const view = render(<SpecimenCopyInContext {...input} />);
    expect(view.container.querySelector("[data-ds-specimen-need='true']")).toBeTruthy();
    expect(view.container.querySelector("[data-copy-role]")).toBeNull();
    cleanup();
  }
});

it("adopts the existing Writer package export and renders through its real public Studio entry", () => {
  expect(writerPackageEvidence.find(row => row.module === "@clossys/designer/studio")).toMatchObject({ version: "0.12.0", values: expect.arrayContaining(["SpecimenCopyInContext"]) });
  const selected = context.profile.surfaces!.fills["sections.specimen-copy-in-context"]!;
  expect(selected.document.sections!["specimen-copy-in-context"]!.impl).toEqual({ kind: "package", module: "@clossys/designer/studio", export: "SpecimenCopyInContext" });
  expect(context.profile.surfaces!.check.findings.filter(row => row.severity === "error")).toEqual([]);
  expect(writerPackageLibrary.surfaces!.files).toEqual([]);
  const errors = vi.spyOn(console, "error");
  const view = render(<studio.SpecimenCopyInContext {...props(6)} expanded />);
  expect(view.container.querySelectorAll("[data-copy-role]")).toHaveLength(6);
  expect(view.container.querySelector("[data-readonly='true']")).toBeTruthy();
  expect(errors).not.toHaveBeenCalled();
});

it("refuses wrong package export evidence and a context missing its selected native module", () => {
  const packages = writerPackageEvidence.map(row => row.module === "@clossys/designer/studio" ? { ...row, values: row.values.filter(name => name !== "SpecimenCopyInContext") } : row);
  const profile = resolveComposite({ catalog: writerPackageCatalog, library: writerPackageLibrary, componentOptions: writerPackageComponentOptions, surfaceOptions: { packages, measurements: [] } });
  expect(profile.surfaces!.check.findings).toContainEqual(expect.objectContaining({ code: "S4", subject: "sections.specimen-copy-in-context", severity: "error" }));
  const view = render(<studio.SpecimenCopyInContext {...props(6, { ...context, modules: {} })} />);
  expect(screen.getByRole("status")).toHaveTextContent("module-unavailable");
  expect(view.container.querySelector("[data-copy-role]")).toBeNull();
});

it("preserves actual emitted Table and Accordion parts through exact native context binding", () => {
  const bound = bindNativeSpecimenContext(emittedContext, emittedComponents);
  expect(bound).toBe(emittedContext);
  expect(contentSpecimenNeeds("sections.specimen-copy-in-context", props(6, emittedContext))).toEqual([]);
  const errors = vi.spyOn(console, "error");
  const view = render(<studio.SpecimenCopyInContext {...props(6, emittedContext)} />);
  expect(screen.getAllByRole("columnheader")).toHaveLength(roles.length + 1);
  fireEvent.click(screen.getByRole("button", { name: "Show all 6" }));
  expect(visible(view.container, "[data-copy-role]")).toHaveLength(6);
  expect(screen.getByRole("button", { name: "Native cta 2" })).toBeVisible();
  expect(view.container.querySelector("[data-ds-specimen-need='true']")).toBeNull();
  expect(bindNativeSpecimenContext(emittedContext, { Button: emittedComponents.Table })).toMatchObject({ leaf: "sections.specimen", reason: expect.stringContaining("does not belong to this emitted consumer revision") });
  expect(errors).not.toHaveBeenCalled();
});
