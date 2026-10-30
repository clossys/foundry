import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import * as rac from "react-aria-components";
import * as components from "../../components/index.js";
import { ConsumerComponentProvider, type ConsumerComponentSelection } from "../component-leaf.client.js";
import { loadCatalogBundles } from "../../catalog-bundles.js";
import { applyComponentLibraryChange } from "../../catalog-core/changeset-components.js";
import { componentDescriptorHash, componentLibraryHash, type ComponentLibrary } from "../../catalog-core/resolve-components.js";
import { loadCatalog, loadComponentRegistry } from "../../catalog-core/index.js";
import { completedCatalogLibrary } from "../../catalog-core/__fixtures__/completed-catalog-library.js";
import { resolve } from "../../catalog-core/api.js";
import type { CompositeResolved } from "../../catalog-core/types.js";
import type { RuntimeContent, RuntimeJson, RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { runtimeHash } from "../../catalog-core/runtime-ports.js";
import { surfaceRuntimeRenderers } from "../index.js";
import { renderCards } from "./cards.js";
import { editorialDate } from "../../blocks/PageHeaderMetadata.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";

const source = { id: "editorial-fixture", kind: "consumer", author: "consumer", license: "MIT" } as const;
let selection: ConsumerComponentSelection;
let profile: CompositeResolved;
function sourceModule(files: readonly { path: string; content: string }[], entry: string, dependency: (leaf: string) => unknown) {
  const code = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import {readFileSync} from 'node:fs'; import {posix} from 'node:path'; import {build} from 'esbuild';
    const x=JSON.parse(readFileSync(0,'utf8')), files=new Map(x.files.map(f=>[f.path,f.content]));
    const find=p=>[p,p.replace(/\\.js$/,'.ts'),p.replace(/\\.js$/,'.tsx'),p+'.ts',p+'.tsx',p+'/index.ts'].find(k=>files.has(k));
    const b=await build({entryPoints:[x.entry],bundle:true,write:false,format:'cjs',platform:'node',packages:'external',jsx:'automatic',logLevel:'silent',plugins:[{name:'native-source',setup(b){
      b.onResolve({filter:/.*/},a=>{if(a.kind==='entry-point')return {path:a.path,namespace:'source'}; if(!a.path.startsWith('.'))return {path:a.path,external:true};const p=posix.normalize(posix.join(posix.dirname(a.importer),a.path)), f=find(p);if(f)return {path:f,namespace:'source'};const leaf=/(?:^|\\/)components\\/([a-z][a-z0-9-]*)\\/index(?:\\.js)?$/.exec(p)?.[1];return leaf?{path:'leaf:'+leaf,external:true}:{errors:[{text:'unresolved '+p}]};});
      b.onLoad({filter:/.*/,namespace:'source'},a=>({contents:files.get(a.path),loader:a.path.endsWith('.tsx')?'tsx':'ts'}));}}]});process.stdout.write(b.outputFiles[0].text);
  `], { input: JSON.stringify({ files, entry }), encoding: "utf8" });
  const module: { exports: Record<string, unknown> } = { exports: {} }, host = createRequire(import.meta.url);
  const require = (id: string) => id.startsWith("leaf:") ? dependency(id.slice(5)) : id === "react-aria-components" ? rac : id === "@clossys/designer/components" ? components : host(id);
  new Function("require", "exports", "module", code)(require, module.exports, module);
  return module.exports;
}

beforeAll(() => {
  const bundles = loadCatalogBundles(), preferred = new Set(["components.card", "components.badge"]);
  const catalog = { slots: loadComponentRegistry().slots, fills: bundles.componentFills };
  let library: ComponentLibrary = { source, adoptedAt: "2026-10-30", fills: [], files: [] };
  const adopted = new Set<string>();
  const adopt = (slot: string) => {
    if (adopted.has(slot)) return;
    const origin = preferred.has(slot) ? "shadcn@aria" : "foundry";
    const doc = catalog.fills.find(doc => doc.$extensions["com.clossys.fill"].slot === slot && doc.$extensions["com.clossys.fill"].source === origin);
    if (!doc) throw new Error(`Missing actual fixture candidate ${slot}`);
    const fill = Object.values(doc.components)[0]!;
    for (const child of [...fill.reads.components, ...fill.composes]) adopt(child);
    library = applyComponentLibraryChange(catalog, library, { baseHash: componentLibraryHash(library), changes: [{ op: "adopt", slot, source: origin }] }, bundles.sourceBundles);
    adopted.add(slot);
  };
  for (const slot of [...preferred, "components.link", "components.semantic-content"]) adopt(slot);
  const values = loadCatalog(), complete = completedCatalogLibrary(values, source, "2026-10-30"), { source: _source, adoptedAt: _date, ...owned } = complete;
  profile = resolve({ catalog: { values, components: catalog }, library: { source, adoptedAt: "2026-10-30", values: owned, components: library } });
  const modules: Record<string, Record<string, unknown>> = { "@clossys/designer/components": components };
  const dependency = (leaf: string): unknown => {
    const chosen = profile.components.components[`components.${leaf}`];
    if (!chosen) throw new Error(`Unselected dependency ${leaf}`);
    const id = chosen.impl.kind === "source" ? chosen.impl.entry : chosen.impl.module;
    return modules[id] ??= chosen.impl.kind === "source" ? sourceModule(library.files, chosen.impl.entry, dependency) : components;
  };
  for (const slot of adopted) dependency(slot.slice(11));
  selection = { profile, selectionHash: profile.components.selectionHash, modules,
    descriptors: Object.fromEntries(Object.entries(profile.components.components).map(([id, item]) => [id, componentDescriptorHash(item.descriptor)])) };
}, 120_000);
afterEach(cleanup);

function input(records: RuntimeJson, config: string | null = "post"): RuntimeRenderInput<import("react").ReactNode> {
  const ref = { kind: "records" as const, ref: "specimen:editorial/records" };
  const content: RuntimeContent = { reference: ref, value: records, hash: runtimeHash(records) };
  return { path: "sections.preview.0", cell: { theme: "light", state: "default", width: 1280 }, locale: "en-GB", profile,
    fill: { kind: "section", library: "foundry", fill: "foundry/sections.cards", leaf: "sections.cards", config, slots: ["records"], members: ["layout.grid", "layout.list"], states: [], renderer: { id: "foundry/sections.cards", source: { entry: "cards.tsx", files: {}, dependencies: {} }, sourceHash: runtimeHash("registered-cards-preview") } },
    selection: { leaf: "sections.cards", fill: "foundry/sections.cards", config, members: [], content: { records: ref } }, content: { records: content }, slots: {} };
}
const records = [{ id: "guide", title: "A durable editorial layout", href: "/journal/durable", description: "Host-authored description", editorial: { author: { name: "Alex", label: "Written by" }, date: { value: "2026-10-29", label: "Published" }, readingTime: { value: "4 min", label: "Read" }, tags: [{ id: "design", label: "Design systems" }] } }];

describe("registered editorial Cards specimen", () => {
  it("renders real shadcn Card parts and host metadata through selected leaves", async () => {
    render(<ConsumerComponentProvider value={selection}>{surfaceRuntimeRenderers["sections.cards"]!.render(input(records))}</ConsumerComponentProvider>);
    expect(await screen.findByRole("heading", { name: records[0]!.title })).toBeVisible();
    expect(screen.getByRole("link", { name: records[0]!.title })).toHaveAttribute("href", "/journal/durable");
    expect(screen.getByText("Alex")).toBeVisible(); expect(screen.getByText("29 October 2026")).toBeVisible();
    expect(document.querySelector("[data-slot=card-content]")).not.toBeNull();
    expect(document.querySelector("[data-ds-leaf='sections.cards']")).not.toBeNull();
    expect(document.querySelector("[data-slot=badge]")).not.toBeNull();
  });
  it("keeps the Studio's own registered sample editorial and uses featured layout", async () => {
    const sample = surfaceRuntimeRenderers["sections.cards"]!.sample(specimenDataset);
    render(<ConsumerComponentProvider value={selection}>{renderCards(input(sample.records!, "post-featured"))}</ConsumerComponentProvider>);
    expect((await screen.findAllByText("Studio author"))[0]).toBeVisible();
    expect(document.querySelector("[data-card-config=post-featured]")).toHaveClass("flex-col");
  });
  it("refuses unsupported configuration, missing Writer titles and malformed media", () => {
    expect(() => renderCards(input(records, "invented"))).toThrow(/unsupported editorial/);
    expect(() => renderCards(input([{ id: "bad" }]))).toThrow(/id and a title/);
    expect(() => renderCards(input([{ id: "bad", title: "Bad", image: { kind: "photo", src: "/a.jpg", width: 10, height: 10 } }]))).toThrow(/assets.image/);
  });
  it("keeps ISO dates locale-bound and rejects impossible days", () => {
    expect(editorialDate("2026-10-29", "en-GB")).toBe("29 October 2026");
    expect(() => editorialDate("2026-02-30", "en-GB")).toThrow(/calendar date/);
    expect(() => editorialDate("2026-10-29", undefined)).toThrow(/page locale/);
  });
});
