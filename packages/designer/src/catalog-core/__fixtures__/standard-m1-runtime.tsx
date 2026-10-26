/** Standard M1 assembly fixture: real public section exports, a consumer-owned fixture frame.
 * This is not Publisher SiteFrame, a deployed site, or a browser qualification record.
 */
import { Children, type ReactElement } from "react";
import { Hero, ArticleBody, SectionFrame } from "../../blocks/server.js";
import { applyLibraryChange, libraryHash, resolve } from "../api.js";
import { completedTokenLibrary } from "../../importers/__fixtures__/completed-token-library.js";
import { loadCatalog, loadBuildCatalog } from "../index.js";
import { runtimeHash } from "../runtime-ports.js";
import type { CompositeEngineInput } from "../types.js";
import type { RuntimeAssemblyIdentity, RuntimeAssemblyInput, RuntimeFlowAssemblyInput } from "../runtime-assembly.js";
import type { ConsumerRuntimeManifest, RuntimeContent, RuntimeFillDescriptor, RuntimeRendererDescriptor, RuntimeSourceClosure } from "../runtime-ports.js";

/** Source and CSS bytes are mandatory caller inputs, never invented proof pins. */
export function standardM1Runtime(options: {
  engine: CompositeEngineInput;
  identity: RuntimeAssemblyIdentity;
  source: RuntimeSourceClosure;
  css: RuntimeAssemblyInput<ReactElement>["css"];
  assets?: RuntimeAssemblyInput<ReactElement>["assets"];
}): RuntimeFlowAssemblyInput<ReactElement> {
  const { engine } = options;
  const renderer = (id: string): RuntimeRendererDescriptor => ({ id, source: options.source, sourceHash: runtimeHash(options.source) });
  const descriptor = (kind: "frame" | "section", leaf: RuntimeFillDescriptor["leaf"], slots: readonly string[]): RuntimeFillDescriptor => ({ kind, leaf, fill: `${engine.library.source.id}/${leaf}`, library: engine.library.source.id, config: null, slots, members: [], states: ["default"], renderer: renderer(`standard-m1:${leaf}`) });
  const frame = descriptor("frame", "frames.site-shell", ["skip-link", "header", "main", "footer"]);
  const hero = descriptor("section", "sections.hero", ["header"]);
  const article = descriptor("section", "sections.article", ["body"]);
  const hash = libraryHash(engine.library) as `sha256:${string}`;
  const manifest: ConsumerRuntimeManifest = { version: 1, consumer: engine.library.source.id, libraryHash: hash, selectionHash: hash, fills: [frame, hero, article], assetClosure: { complete: true, ids: [] } };
  const content: Readonly<Record<string, string>> = { skip: "Skip to content", header: "Standard M1", hero: "Made for a clear first impression", article: "A real content region composed through the consumer library.", footer: "Standard M1 fixture" };
  const ref = (name: string) => ({ kind: "region" as const, ref: `standard-m1.${name}` });
  const select = (fill: RuntimeFillDescriptor, slots: Record<string, string>) => ({ leaf: fill.leaf, fill: fill.fill, config: null, members: [], content: Object.fromEntries(Object.entries(slots).map(([slot, name]) => [slot, ref(name)])) });
  return {
    identity: options.identity, engine, contracts: loadBuildCatalog(), themes: ["light", "dark"], states: ["default"], css: options.css, assets: options.assets ?? [],
    ports: { manifest, resolveContent: reference => {
      const value = content[reference.ref.slice("standard-m1.".length)];
      return value === undefined ? undefined : { reference, value, hash: runtimeHash(value) } satisfies RuntimeContent;
    }, renderers: {
      [frame.renderer.id]: input => <div data-runtime-path={input.path} data-theme={input.cell.theme}>
        <a href="#main-content">{String(input.content["skip-link"]!.value)}</a>
        <header>{String(input.content.header!.value)}</header>
        <main id="main-content" tabIndex={-1}>{Children.toArray(input.slots.main)}</main>
        <footer>{String(input.content.footer!.value)}</footer>
      </div>,
      [hero.renderer.id]: input => <div data-runtime-path={input.path}><Hero heading={String(input.content.header!.value)} /></div>,
      [article.renderer.id]: input => <div data-runtime-path={input.path}><SectionFrame measure="prose"><ArticleBody><h2>What this offers</h2><p>{String(input.content.body!.value)}</p></ArticleBody></SectionFrame></div>,
    } },
    binding: { id: "standard-m1-home", frame: select(frame, { "skip-link": "skip", header: "header", footer: "footer" }), frameSlots: {}, sections: { body: [select(hero, { header: "hero" }), select(article, { body: "article" })] } },
    layout: { descriptor: { library: engine.library.source.id, fill: `${engine.library.source.id}/layouts.stack`, leaf: "layouts.stack", config: "landing", members: {}, slots: [{ id: "body", min: 1, max: 10, accepts: ["sections.hero", "sections.article"] }], breakpoints: [], states: ["default"], renderer: renderer("standard-m1:layout") },
      render: input => <div data-runtime-layout="standard-m1-stack">{Children.toArray(input.slots.body)}</div>, expectedOrder: (_cell, paths) => paths.body ?? [],
    },
  };
}

/** Bounded token-only consumer for structural fixture tests; no component qualification claim. */
export function standardM1FixtureEngine(): CompositeEngineInput {
  const all = loadCatalog();
  const values = { ...all, slots: all.slots.filter(slot => slot.layer === "tokens"), fills: all.fills.filter(fill => !!fill.tokens) };
  const source = { id: "standard-m1-fixture", kind: "consumer" as const, author: "consumer" as const, license: "MIT" };
  let library = completedTokenLibrary(values, source, "2026-10-24");
  // This SYNTHETIC fixture explicitly authors pixel tokens from its 16px calibration;
  // production assembly never makes this conversion or assumes a root font size.
  const profile = resolve({ catalog: values, library });
  const tokens = Object.fromEntries(Object.entries(profile.members).filter(([, member]) => member.slot === "tokens.breakpoint").map(([id, member]) => {
    const value = member.value.light as { unit: string; value: number };
    return [id.slice("tokens.breakpoint.".length), { $type: "dimension" as const, $value: { unit: "px", value: value.value * (value.unit === "rem" ? 16 : 1) } }];
  }));
  library = applyLibraryChange(values, library, { baseHash: libraryHash(library), changes: [{ op: "author", slot: "tokens.breakpoint", tokens }] });
  const { source: _source, adoptedAt, ...portion } = library;
  return { catalog: { values, components: { slots: [], fills: [] } }, library: { source, adoptedAt, values: portion, components: { fills: [], files: [] } } };
}
