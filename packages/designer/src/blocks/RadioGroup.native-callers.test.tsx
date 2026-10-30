import { Suspense, type ReactNode } from "react";
import { beforeAll, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as nativeRadio from "../components/preview-runtime/components/radio-group/radio-group.js";
import { MatrixChoices } from "./matrix/choices.js";
import { SemanticContent } from "../components/SemanticContent.js";
import { ConsumerComponentProvider, type ConsumerComponentSelection } from "../runtime/component-leaf.client.js";
import { loadCatalogBundles, installedHeadlessLibrary } from "../catalog-bundles.js";
import { loadCatalog, loadComponentRegistry, type LibraryData } from "../catalog-core/index.js";
import { applyLibraryChange, libraryHash, resolve } from "../catalog-core/api.js";
import { emittedTokenProperties } from "../catalog-core/emit.js";
import { applyComponentLibraryChange } from "../catalog-core/changeset-components.js";
import { componentDescriptorHash, componentLibraryHash, resolveComponents, type ComponentLibrary } from "../catalog-core/resolve-components.js";

let selection: ConsumerComponentSelection;
beforeAll(() => {
  const values = loadCatalog(), bundles = loadCatalogBundles(), registry = loadComponentRegistry();
  const source: LibraryData["source"] = { kind: "consumer", author: "consumer", id: "native-radio-matrix", license: "MIT" };
  const empty: LibraryData = { source, fills: [], adoptedAt: "2026-10-30" };
  const changes = values.slots.filter(slot => slot.layer === "tokens").flatMap(slot => {
    const offers = values.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === slot.id && doc.$extensions["com.clossys.fill"].mode !== "reference");
    const chosen = offers.find(doc => doc.$extensions["com.clossys.fill"].source === "foundry") ?? offers[0];
    return chosen ? [{ op: "adopt" as const, slot: slot.id, source: chosen.$extensions["com.clossys.fill"].source }] : [];
  });
  const profile = resolve({ catalog: values, library: applyLibraryChange(values, empty, { baseHash: libraryHash(empty), changes }) });
  const tokens = Object.fromEntries([...emittedTokenProperties(profile)].map(([id, output]) => {
    let member = profile.members[id]!;
    while (member.alias.light) member = profile.members[member.alias.light]!;
    return [id, { property: output.property, light: member.css.light }];
  }));
  const catalog = { slots: registry.slots, fills: bundles.componentFills };
  const base: ComponentLibrary = { source, fills: [], files: [], adoptedAt: empty.adoptedAt };
  const library = applyComponentLibraryChange(catalog, base, { baseHash: componentLibraryHash(base), changes: [
    { op: "adopt", slot: "components.radio-group", source: "shadcn@aria" },
    { op: "adopt", slot: "components.semantic-content", source: "foundry" },
  ] }, bundles.sourceBundles);
  const components = resolveComponents({ catalog, library, values: { tokens, assets: [] }, evidence: { observations: {}, installedRac: installedHeadlessLibrary() } });
  selection = { profile: { components }, selectionHash: components.selectionHash,
    descriptors: Object.fromEntries(Object.entries(components.components).map(([leaf, chosen]) => [leaf, componentDescriptorHash(chosen.descriptor)])),
    modules: { "components/radio-group/radio-group.tsx": nativeRadio, "@clossys/designer/components": { SemanticContent } } };
});
const selected = (children: ReactNode) => <ConsumerComponentProvider value={selection}><Suspense>{children}</Suspense></ConsumerComponentProvider>;


it("keeps MatrixChoices row naming, controlled choice changes, and focus callbacks with native RadioGroup", async () => {
  const change=vi.fn(),focus=vi.fn(),user=userEvent.setup();
  const columns=[{id:'a',label:'Source A'},{id:'b',label:'Source B'}];
  const row={id:'row',label:'Delivery',name:<span>Delivery choice</span>,selected:'a',cells:{a:<nativeRadio.RadioGroupItem value='a'>Source A</nativeRadio.RadioGroupItem>,b:<nativeRadio.RadioGroupItem value='b'>Source B</nativeRadio.RadioGroupItem>}};
  const view=render(selected(<MatrixChoices arrangement='choices' aria-label='Delivery comparison' columns={columns} rows={[row]} onChange={change} onFocusCell={focus}/>));
  const group=await screen.findByRole('radiogroup',{name:'Delivery choice'});
  expect(group).toHaveAttribute('aria-orientation','horizontal');
  await user.click(within(group).getByRole('radio',{name:'Source B'}));
  expect(change).toHaveBeenCalledWith('row','b');
  expect(focus).toHaveBeenCalledWith('row','b');
  view.rerender(selected(<MatrixChoices arrangement='choices' aria-label='Delivery comparison' columns={columns} rows={[{...row,selected:'b'}]} onChange={change}/>));
  expect(await screen.findByRole('radio',{name:'Source B'})).toBeChecked();
});
