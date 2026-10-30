/** Preview-only selected modules. Native source resolution is not consumer adoption or CSS qualification. */
import type { ReactNode } from "react";
import selected from "./__fixtures__/default-component-preview-profile.json" with { type: "json" };
import * as components from "../components/index.js";
import * as charts from "../charts/index.js";
import * as nativeButton from "../components/preview-runtime/components/button/button.js";
import * as nativeCard from "../components/preview-runtime/components/card/card.js";
import * as nativeTabs from "../components/preview-runtime/components/tabs/tabs.js";
import { defaultSourceModules } from "../components/preview-runtime/modules.js";
import { ConsumerComponentProvider, type ConsumerComponentSelection } from "../runtime/component-leaf.client.js";
import { loadCatalogBundles, installedHeadlessLibrary } from "../catalog-bundles.js";
import { loadCatalog } from "../catalog-core/index.js";
import { applyLibraryChange, libraryHash, resolve } from "../catalog-core/api.js";
import { emittedTokenProperties } from "../catalog-core/emit.js";
import { loadComponentRegistry } from "../catalog-core/component-registry.js";
import { applyComponentLibraryChange } from "../catalog-core/changeset-components.js";
import { componentDescriptorHash, componentLibraryHash, resolveComponents, type ComponentLibrary, type ResolvedComponents } from "../catalog-core/resolve-components.js";
import { runtimeHash } from "../catalog-core/runtime-ports.js";
import type { LibraryData } from "../catalog-core/types.js";
let retained: ConsumerComponentSelection | undefined;
export function marketingComponentSelection(): ConsumerComponentSelection {
  if (retained) return retained;
  const catalog = loadCatalog();
  let values: LibraryData = { source: { kind: "consumer", author: "consumer", id: "marketing-specimens", license: "MIT" }, fills: [], adoptedAt: "2026-10-30" };
  const changes = catalog.slots.filter(slot => slot.layer === "tokens").flatMap(slot => {
    const offers = catalog.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === slot.id && doc.$extensions["com.clossys.fill"].mode !== "reference");
    const chosen = offers.find(doc => doc.$extensions["com.clossys.fill"].source === "foundry") ?? offers[0];
    return chosen ? [{ op: "adopt" as const, slot: slot.id, source: chosen.$extensions["com.clossys.fill"].source }] : [];
  });
  values = applyLibraryChange(catalog, values, { baseHash: libraryHash(values), changes });
  const resolved = resolve({ catalog, library: values });
  const css = (id: string, mode: "light" | "dark"): string => { let member = resolved.members[id]!; while (member.alias[mode] ?? member.alias.light) member = resolved.members[(member.alias[mode] ?? member.alias.light)!]!; return member.css[mode] ?? member.css.light; };
  const tokens = Object.fromEntries([...emittedTokenProperties(resolved)].map(([id, output]) => [id, { property: output.property, light: css(id, "light"), ...(resolved.members[id]!.value.dark === undefined ? {} : { dark: css(id, "dark") }) }]));
  const bundles = loadCatalogBundles(), registry = loadComponentRegistry();
  const componentCatalog = { slots: registry.slots, fills: bundles.componentFills };
  let library: ComponentLibrary = { source: values.source, fills: [], files: [], adoptedAt: values.adoptedAt };
  library = applyComponentLibraryChange(componentCatalog, library, { baseHash: componentLibraryHash(library), changes: ["components.button", "components.card", "components.tabs"].map(slot => ({ op: "adopt" as const, slot, source: "shadcn@aria" })) }, bundles.sourceBundles);
  const native = resolveComponents({ catalog: componentCatalog, library, values: { tokens, assets: [] }, evidence: { observations: {}, installedRac: installedHeadlessLibrary() } });
  const base = structuredClone(selected) as unknown as ResolvedComponents;
  const files = new Map(base.files.map(file => [file.path, file])); for (const file of native.files) files.set(file.path, file);
  const profile = { ...base, components: { ...base.components, ...native.components }, files: [...files.values()], selectionHash: runtimeHash({ base: base.selectionHash, native: native.selectionHash }) };
  retained = { profile: { components: profile }, selectionHash: profile.selectionHash, descriptors: Object.fromEntries(Object.entries(profile.components).map(([leaf, chosen]) => [leaf, componentDescriptorHash(chosen.descriptor)])), modules: { ...defaultSourceModules, "@clossys/designer/components": components, "@clossys/designer/charts": charts, "components/button/button.tsx": nativeButton, "components/card/card.tsx": nativeCard, "components/tabs/tabs.tsx": nativeTabs } };
  return retained;
}
export function MarketingComponentProvider({ children }: { readonly children: ReactNode }) { return <ConsumerComponentProvider value={marketingComponentSelection()}>{children}</ConsumerComponentProvider>; }
