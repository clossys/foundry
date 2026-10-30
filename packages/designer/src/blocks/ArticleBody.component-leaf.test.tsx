import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { Suspense } from "react";
import { render, screen } from "@testing-library/react";
import { beforeAll, expect, it } from "vitest";
import * as components from "../components/index.js";
import { ConsumerComponentProvider, type ConsumerComponentSelection } from "../runtime/component-leaf.client.js";
import { loadCatalog } from "../catalog-core/index.js";
import { applyLibraryChange, libraryHash, resolve } from "../catalog-core/api.js";
import { emittedTokenProperties } from "../catalog-core/emit.js";
import { loadCatalogBundles } from "../catalog-bundles.js";
import { loadComponentRegistry } from "../catalog-core/component-registry.js";
import { applyComponentLibraryChange } from "../catalog-core/changeset-components.js";
import { componentDescriptorHash, componentLibraryHash, resolveComponents, type ComponentLibrary } from "../catalog-core/resolve-components.js";
import type { LibraryData } from "../catalog-core/types.js";
import { surfaceRuntimePreview } from "../runtime/preview.js";
import articleFill from "../catalog/fills/foundry/sections.article.json" with { type: "json" };
import { groupASectionInput } from "../runtime/sections/group-a-dataset.js";
import { renderArticleSection } from "../runtime/sections/article.js";

let selection: ConsumerComponentSelection;
beforeAll(() => {
  const values = loadCatalog();
  let library: LibraryData = { source: { kind: "consumer", author: "consumer", id: "article-specimen", license: "MIT" }, adoptedAt: "2026-10-30", fills: [] };
  const changes = values.slots.filter(slot => slot.layer === "tokens" || slot.id.startsWith("assets.icon-")).flatMap(slot => {
    const offers = values.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === slot.id && doc.$extensions["com.clossys.fill"].mode !== "reference").map(doc => doc.$extensions["com.clossys.fill"].source);
    const source = ["foundry", "tailwind-default"].find(name => offers.includes(name)) ?? offers[0];
    return source ? [{ op: "adopt" as const, slot: slot.id, source }] : [];
  });
  library = applyLibraryChange(values, library, { baseHash: libraryHash(library), changes });
  const resolved = resolve({ catalog: values, library });
  const literal = (id: string): string => { let member = resolved.members[id]!; while (member.alias.light) member = resolved.members[member.alias.light]!; return member.css.light; };
  const tokens = Object.fromEntries([...emittedTokenProperties(resolved)].map(([id, output]) => [id, { property: output.property, light: literal(id) }]));
  const assets = [...new Set(Object.values(resolved.members).filter(member => member.slot.startsWith("assets.")).map(member => member.slot))];
  const bundles = loadCatalogBundles();
  const catalog = { slots: loadComponentRegistry().slots, fills: bundles.componentFills };
  const empty: ComponentLibrary = { source: { kind: "consumer", author: "consumer", id: "article-specimen", license: "MIT" }, adoptedAt: "2026-10-30", fills: [], files: [] };
  const adopted = applyComponentLibraryChange(catalog, empty, { baseHash: componentLibraryHash(empty), changes: [
    { op: "adopt", slot: "components.semantic-content", source: "foundry" },
    { op: "adopt", slot: "components.link", source: "foundry" },
    { op: "adopt", slot: "components.icon", source: "foundry" },
    { op: "adopt", slot: "components.card", source: "shadcn@aria" },
  ] }, bundles.sourceBundles);
  const profile = resolveComponents({ catalog, library: adopted, values: { tokens, assets }, packageExports: { "@clossys/designer/components": Object.keys(components) } });
  const card = profile.components["components.card"]!;
  if (card.impl.kind !== "source") throw new Error("Expected the native adopted shadcn Card source");
  const bundled = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import {readFileSync} from 'node:fs'; import {posix} from 'node:path'; import {build} from 'esbuild';
    const data=JSON.parse(readFileSync(0,'utf8')),files=new Map(data.files.map(row=>[row.path,row.content]));
    const out=await build({entryPoints:[data.entry],bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',packages:'external',logLevel:'silent',plugins:[{name:'native-source',setup(b){b.onResolve({filter:/.*/},a=>{if(a.kind==='entry-point')return{path:a.path,namespace:'native'};if(!a.path.startsWith('.'))return{path:a.path,external:true};const p=posix.normalize(posix.join(posix.dirname(a.importer),a.path));const found=[p,p+'.ts',p+'.tsx',p.replace(/\\.js$/,'.ts'),p.replace(/\\.js$/,'.tsx'),p+'/index.ts'].find(x=>files.has(x));return found?{path:found,namespace:'native'}:{errors:[{text:'Unresolved native source '+p}]}});b.onLoad({filter:/.*/,namespace:'native'},a=>({contents:files.get(a.path),loader:a.path.endsWith('.tsx')?'tsx':'ts'}))}}]});process.stdout.write(out.outputFiles[0].text);
  `], { input: JSON.stringify({ files: profile.files, entry: card.impl.entry }), encoding: "utf8" });
  const module = { exports: {} as Record<string, unknown> };
  new Function("require", "exports", "module", bundled)(createRequire(import.meta.url), module.exports, module);
  selection = { profile: { components: profile }, selectionHash: profile.selectionHash, descriptors: Object.fromEntries(Object.entries(profile.components).map(([id, value]) => [id, componentDescriptorHash(value.descriptor)])), modules: { "@clossys/designer/components": components, [card.impl.entry]: module.exports } };
});

it("renders the registered article specimen using the actual adopted shadcn Card and selected content/link leaves", async () => {
  const preview = surfaceRuntimePreview(articleFill.sections.article);
  expect(preview).toHaveProperty("render");
  if (!("render" in preview)) throw new Error(preview.reason);
  const { container } = render(<ConsumerComponentProvider value={selection}><Suspense fallback={null}>{preview.render()}</Suspense></ConsumerComponentProvider>);
  expect(await screen.findByRole("article")).toHaveAttribute("data-ds-leaf", "sections.article");
  expect(container.querySelector('[data-slot="card"]')).not.toBeNull();
  expect(screen.getByRole("navigation")).toHaveAccessibleName("On this page");
  const reference = container.querySelector('[data-footnote-reference]')!;
  expect(reference).toHaveAttribute("href", "#article-note-1");
  expect(container.querySelector('#article-note-1 [data-footnote-backlink]')).toHaveAttribute("href", "#article-reference-1");
});

it("refuses broken editorial references before rendering instead of dropping notes", () => {
  const fill = articleFill.sections.article;
  const input = groupASectionInput("article", articleFill);
  const body = input.content.body!;
  const invalid = { ...input, content: { ...input.content, body: { ...body, value: [{ kind: "footnotes", text: "Notes", items: ["One"], references: [] }] } } };
  expect(() => renderArticleSection(invalid)).toThrow(/non-empty list/);
});
