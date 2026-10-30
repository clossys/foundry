import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { Suspense, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { SemanticContent } from "../../../components/SemanticContent.js";
import { importShadcnAriaComponents, materializeShadcnComponent, type ShadcnComponentInput } from "../../../importers/shadcn-aria-components.js";
import { componentDescriptorHash, componentOf, verifyComponentOutput, type ComponentCandidateDocument, type ResolvedComponents } from "../../../catalog-core/resolve-components.js";
import { ConsumerComponentProvider, type ConsumerComponentSelection } from "../../../runtime/component-leaf.client.js";
import cardDocument from "../../../catalog/fills/shadcn@aria/components.card.json" with { type: "json" };

let cached: Promise<ConsumerComponentSelection> | undefined;
/** Compile the authenticated selected Card bytes; pending qualification stays pending. */
export function nativeStatsSelection(): Promise<ConsumerComponentSelection> {
  return cached ??= (async () => {
    const fixtureRoot = resolve(import.meta.dirname, "../../../importers/__fixtures__/shadcn-aria");
    const read = (name: string) => readFileSync(resolve(fixtureRoot, name), "utf8");
    const input: ShadcnComponentInput = {
      items: readdirSync(fixtureRoot).filter(name => name.endsWith(".json")).map(name => JSON.parse(read(name))).filter(item => item.type === "registry:ui"),
      styles: { path: "apps/v4/registry/styles/style-nova.css", content: read("style-nova.css") }, notice: { path: "LICENSE.md", content: read("LICENSE.md") },
    };
    const files = materializeShadcnComponent(importShadcnAriaComponents(input), "card");
    const document: ComponentCandidateDocument = JSON.parse(JSON.stringify(cardDocument));
    const descriptor = componentOf(document);
    verifyComponentOutput(descriptor, files);
    if (descriptor.impl.kind !== "source") throw new Error("Expected selected native Card source");
    const require = createRequire(import.meta.url);
    // Node compiles outside jsdom's Uint8Array realm. No source is replaced by a test component.
    const compiled = execFileSync(process.execPath, ["-e", `
      const {build}=require(process.argv[1]), {posix}=require('node:path');
      const input=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
      const source=new Map(input.files.map(file=>[file.path,file.content]));
      build({entryPoints:[input.entry],bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',plugins:[{name:'selected-card-bytes',setup(builder){
        builder.onResolve({filter:/.*/},args=>{const path=args.importer?posix.normalize(posix.join(posix.dirname(args.importer),args.path)):args.path;const found=[path,path+'.tsx',path+'.ts'].find(candidate=>source.has(candidate));return found?{path:found,namespace:'selected'}:{path:args.path,external:true}});
        builder.onLoad({filter:/.*/,namespace:'selected'},args=>({contents:source.get(args.path),loader:'tsx'}));
      }}]}).then(result=>process.stdout.write(result.outputFiles[0].text)).catch(error=>{console.error(error.message);process.exitCode=1});
    `, require.resolve("esbuild")], { input: JSON.stringify({ files, entry: descriptor.impl.entry }), encoding: "utf8" });
    const module = { exports: {} };
    new Function("require", "module", "exports", compiled)(require, module, module.exports);
    const profile: ResolvedComponents = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../studio/__fixtures__/default-component-preview-profile.json"), "utf8"));
    const prior = profile.components["components.card"]!;
    profile.components = { ...profile.components, "components.card": { ...prior, impl: descriptor.impl, descriptor, propMap: descriptor.propMap,
      origin: { kind: "adopted", source: descriptor.source, fill: document.$extensions["com.clossys.fill"].id, pin: descriptor.pin, license: descriptor.license, sha256: componentDescriptorHash(descriptor), adoptedAt: "2026-10-30" } } };
    profile.files = [...profile.files, ...files];
    profile.selectionHash = componentDescriptorHash(descriptor);
    return { profile: { components: profile }, selectionHash: profile.selectionHash, descriptors: Object.fromEntries(Object.entries(profile.components).map(([leaf, chosen]) => [leaf, componentDescriptorHash(chosen.descriptor)])), modules: { [descriptor.impl.entry]: module.exports, "@clossys/designer/components": { SemanticContent } } };
  })();
}
export function nativeStatsTree(selection: ConsumerComponentSelection, children: ReactNode) {
  return <ConsumerComponentProvider value={selection}><Suspense>{children}</Suspense></ConsumerComponentProvider>;
}
export async function nativeStatsMarkup(selection: ConsumerComponentSelection, children: ReactNode) {
  let failure: unknown;
  const stream = await renderToReadableStream(nativeStatsTree(selection, children), { onError(error) { failure = error; } });
  await stream.allReady;
  if (failure) throw failure;
  return new Response(stream).text();
}
