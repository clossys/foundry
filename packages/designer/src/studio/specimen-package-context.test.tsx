import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as reactAriaComponents from "react-aria-components";
import * as components from "../components/index.js";
import { loadCatalog, loadComponentRegistry, loadSectionRegistry, applyLibraryChange, libraryHash } from "../catalog-core/index.js";
import { resolveComposite } from "../catalog-core/library-components.js";
import { completedCatalogLibrary } from "../catalog-core/__fixtures__/completed-catalog-library.js";
import { selectedPackageComponentOptions } from "../catalog-core/__fixtures__/surface-engine/selected-package-closure.js";
import { emitComponents } from "../catalog-core/emit-components.js";
import { componentOf, componentDescriptorHash } from "../catalog-core/resolve-components.js";
import type { CompositeCatalogData, CompositeLibraryData } from "../catalog-core/types.js";
import { importFoundryComponents } from "../importers/foundry-components.js";
import { specimenSectionPackageCatalog } from "../importers/specimen-sections.package.js";
import { importShadcnAriaComponents, materializeShadcnComponent, SHADCN_ARIA_RUNTIME_TARGETS } from "../importers/shadcn-aria-components.js";
import { loadCatalogBundles } from "../catalog-bundles.js";
import { readSurfacePackageEvidence } from "../library-cli/surface-package-evidence.js";
import { emittedDesignerSpecimenContext, bindNativeSpecimenContext } from "./emitted-specimens.js";
import { pageViewportCases, SpecimenPageViewports } from "./specimen-content.js";
import type { DesignerSpecimenContext } from "./DesignerSpecimen.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** Explicit current-runtime adaptation of the authenticated Button, without rewriting global defaults. */
function currentButton() {
  const directory = resolve(import.meta.dirname, "../importers/__fixtures__/shadcn-aria");
  const read = (name: string) => readFileSync(resolve(directory, name), "utf8");
  const installed = (name: string): string => JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../node_modules", name, "package.json"), "utf8")).version;
  const imported = importShadcnAriaComponents({
    items: readdirSync(directory).filter(name => name.endsWith(".json")).map(name => JSON.parse(read(name))).filter(item => item.type === "registry:ui"),
    styles: { path: "apps/v4/registry/styles/style-nova.css", content: read("style-nova.css") }, notice: { path: "LICENSE.md", content: read("LICENSE.md") },
    runtimeTargets: { ...SHADCN_ARIA_RUNTIME_TARGETS, button: { react: installed("react"), "react-aria-components": installed("react-aria-components"), "tailwind-merge": installed("tailwind-merge") } },
  });
  const document = imported.fills.find(doc => doc.components.button)!;
  const fill = document.components.button!;
  const upstream = loadCatalogBundles().sourceBundles.find(bundle => bundle.slot === "components.button")!.upstream;
  return { document, bundle: { slot: fill.slot, descriptorHash: componentDescriptorHash(fill), transform: fill.transform, upstream, files: materializeShadcnComponent(imported, "button"), blockers: fill.blockers } };
}

/** Compile the real emitted component graph, retaining one host React/RAC instance. */
function emittedModules(files: readonly { path: string; content: string }[]): Record<string, unknown> {
  const code = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { readFileSync } from "node:fs";
    import { posix } from "node:path";
    import { build } from "esbuild";
    const files = new Map(JSON.parse(readFileSync(0, "utf8")).map(file => [file.path, file.content]));
    const find = path => [path,path.replace(/\\.js$/, ".ts"),path.replace(/\\.js$/, ".tsx"),path+".ts",path+".tsx",path+"/index.ts"].find(name=>files.has(name));
    const result = await build({entryPoints:["component-index.ts"],bundle:true,write:false,format:"cjs",platform:"node",jsx:"automatic",logLevel:"silent",plugins:[{name:"actual-emitted-selection",setup(builder){
      builder.onResolve({filter:/.*/}, args=>{if(args.kind==="entry-point")return{path:args.path,namespace:"selected"};if(!args.path.startsWith("."))return{path:args.path,external:true};const path=find(posix.normalize(posix.join(posix.dirname(args.importer),args.path)));return path?{path,namespace:"selected"}:{errors:[{text:"Missing emitted module "+args.path}]};});
      builder.onLoad({filter:/.*/,namespace:"selected"},args=>({contents:files.get(args.path),loader:args.path.endsWith(".tsx")?"tsx":"ts"}));
    }}]});process.stdout.write(result.outputFiles[0].text);
  `], { input: JSON.stringify(files), encoding: "utf8" });
  const host = createRequire(import.meta.url), module = { exports: {} };
  const require = (name: string) => name === "@clossys/designer/components" ? components : name === "react-aria-components" ? reactAriaComponents : host(name);
  new Function("require", "module", "exports", code)(require, module, module.exports);
  return module.exports;
}

it("the genuine package specimen renders the consumer's reselected native Button, never a package default", async () => {
  const consoleError = vi.spyOn(console, "error");
  const packageDoc = specimenSectionPackageCatalog().find(doc => doc.$extensions["com.clossys.fill"].slot === "sections.specimen-page-viewports")!;
  const packageEntry = Object.values(packageDoc.sections!)[0]!;
  expect(packageEntry.impl).toEqual({ kind: "package", module: "@clossys/designer/studio", export: "SpecimenPageViewports" });
  const shadcnButton = currentButton(), foundry = importFoundryComponents().fills;
  const catalog: CompositeCatalogData = { values: loadCatalog(), components: { slots: loadComponentRegistry().slots, fills: [...foundry, shadcnButton.document] }, surfaces: { slots: loadSectionRegistry().slots, fills: [packageDoc], transforms: [], rules: [], materializations: [] } };
  const values = completedCatalogLibrary(catalog.values, { id: "package-context-consumer", kind: "consumer", author: "consumer", license: "MIT" }, "2026-10-30");
  const { source, adoptedAt, ...portion } = values;
  const empty: CompositeLibraryData = { source, adoptedAt, values: portion, components: { fills: [], files: [] } };
  const available = new Map(foundry.map(doc => [doc.$extensions["com.clossys.fill"].slot, doc])), ordered: string[] = [], seen = new Set<string>();
  const visit = (id: string) => { if (!id.startsWith("components.") || seen.has(id)) return; const fill = componentOf(available.get(id)!); seen.add(id); for (const dep of [...fill.reads.components, ...fill.composes]) visit(dep); ordered.push(id); };
  for (const id of packageEntry.composes ?? []) visit(id);
  const baseComponentOptions = selectedPackageComponentOptions(), surfaceOptions = { packages: await readSurfacePackageEvidence([packageDoc]), measurements: [] };
  // Match Producer's real package-export intake for the authenticated source files.
  // Namespace keys come from installed modules, including observed type-only packages;
  // the native emitter still checks every imported value against this inventory.
  const sourceModules = new Set(shadcnButton.bundle.files.flatMap(file => [...file.content.matchAll(/\b(?:import|export)\s[^;]*?\bfrom\s*["']([^"']+)["']/g)].map(match => match[1]!).filter(module => !module.startsWith(".") && !module.endsWith(".css"))));
  const packageExports: Record<string, readonly string[]> = { ...baseComponentOptions.packageExports };
  for (const module of sourceModules) packageExports[module] = Object.keys(await import(module));
  const componentOptions = { ...baseComponentOptions, packageExports };
  const selected = applyLibraryChange(catalog, empty, { baseHash: libraryHash(empty), changes: ordered.map(slot => ({ portion: "components", change: { op: "adopt", slot, source: "foundry" } })) }, { componentOptions });
  const original = applyLibraryChange(catalog, selected, { baseHash: libraryHash(selected), changes: [{ portion: "surfaces", change: { op: "adopt", slot: "sections.specimen-page-viewports", source: packageDoc.$extensions["com.clossys.fill"].source } }] }, { componentOptions, surfaceOptions });
  const replacement = applyLibraryChange(catalog, original, { baseHash: libraryHash(original), changes: [{ portion: "components", change: { op: "adopt", slot: "components.button", source: "shadcn@aria" } }], bundles: [shadcnButton.bundle] }, { componentOptions, surfaceOptions });
  const viewports = [{ id: "desktop", label: "Desktop", width: 1440, height: 900 }, { id: "tablet", label: "Tablet", width: 768, height: 1024 }, { id: "mobile", label: "Mobile", width: 390, height: 844 }];
  const cases = pageViewportCases({ id: "page", label: "Published page" }, viewports, { page: "Page", viewport: "Viewport" });
  let originalContext: DesignerSpecimenContext | undefined;
  for (const [library, expectedFill] of [[original, "foundry/components.button"], [replacement, "shadcn@aria/components.button"]] as const) {
    const profile = resolveComposite({ catalog, library, componentOptions, surfaceOptions });
    expect(profile.surfaces!.fills["sections.specimen-page-viewports"]!.descriptorHash).toBe(resolveComposite({ catalog, library: original, componentOptions, surfaceOptions }).surfaces!.fills["sections.specimen-page-viewports"]!.descriptorHash);
    const glyphs = Object.fromEntries(Object.values(profile.values.members).filter(member => member.$type === "glyph" && member.slot.startsWith("assets.icon-")).map(member => [member.slot, member.value.light]));
    const modules = emittedModules(emitComponents(profile.components, ["component-index"], { glyphModule: { path: "adapters/glyphs.ts", glyphs } }));
    const bound = emittedDesignerSpecimenContext(profile, { components: modules, surfaces: { SpecimenPageViewports } });
    const context: DesignerSpecimenContext = { ...bound, pagePreview: { engine: "producer-emitted-page@1", origin: "http://127.0.0.1:4300", pages: [{ id: "page", route: "/", previewUrl: "/preview/site/pages/page.html", emitted: true, stage: "preview" }], renderViewport: ({ viewport, page }) => <components.SemanticContent as="div"><iframe title={viewport.label} src={page.previewUrl} sandbox="" width={viewport.width} height={viewport.height} /></components.SemanticContent> } };
    expect(bindNativeSpecimenContext(context, modules)).toBe(context);
    if (originalContext) expect(bindNativeSpecimenContext(originalContext, modules)).toMatchObject({ leaf: "sections.specimen", reason: expect.stringContaining("does not belong") });
    originalContext ??= context;
    const Selected = context.surfaces!["sections.specimen-page-viewports"]!.renderContent!;
    const view = render(<>{Selected({ context, items: cases.items, axes: cases.axes, labels: { showAllVariants: (count: number) => `Show all ${count}` }, need: ({ reason }: { reason: string }) => <components.SemanticContent as="p">{reason}</components.SemanticContent> })}</>);
    // The native layout receives real object-valued items/axes arrays, rather than
    // attempting to normalize those data objects as React children.
    expect(screen.getAllByRole("button").map(button => button.textContent)).toEqual(["Desktop", "Tablet", "Mobile"]);
    expect(screen.getByRole("button", { name: "Tablet" })).toHaveAttribute("data-ds-fill", expectedFill);
    fireEvent.click(screen.getByRole("button", { name: "Tablet" }));
    expect(view.container.querySelector("iframe")).toHaveAttribute("width", "768");
    // The remapped page renders these distinct unkeyed siblings without inventing
    // a shared string key from React's absent (null) key.
    expect(screen.getByText("/")).toBeInTheDocument();
    expect(screen.getByText("preview")).toBeInTheDocument();
    expect(view.container.querySelector("[data-ds-specimen-need]")).toBeNull();
    cleanup();
  }
  expect(consoleError.mock.calls.filter(args => args.some(value => typeof value === "string" && /same key|unique.*key/i.test(value)))).toEqual([]);
}, 60_000);
