// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { expect, it } from "vitest";
import { loadCatalogBundles, installedHeadlessLibrary } from "../catalog-bundles.js";
import { loadCatalog, loadComponentRegistry, type LibraryData, type CompositeLibraryData } from "../catalog-core/index.js";
import { applyLibraryChange, libraryHash, resolve } from "../catalog-core/api.js";
import { emittedTokenProperties } from "../catalog-core/emit.js";
import { planComponentDefaults } from "../catalog-core/component-defaults.js";
import { applyDecisions } from "../library-cli/apply-decisions.js";
import { componentOf } from "../catalog-core/resolve-components.js";

it("adopts the authenticated native Card through the production planner and library writer", () => {
  const values = loadCatalog(), bundles = loadCatalogBundles(), registry = loadComponentRegistry();
  const changes = values.slots.filter(slot => slot.layer === "tokens").flatMap(slot => {
    const offers = values.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === slot.id && doc.$extensions["com.clossys.fill"].mode !== "reference");
    const offer = ["foundry", "tailwind-default"].flatMap(source => offers.filter(doc => doc.$extensions["com.clossys.fill"].source === source))[0] ?? offers[0];
    return offer ? [{ op: "adopt" as const, slot: slot.id, source: offer.$extensions["com.clossys.fill"].source }] : [];
  });
  const source: LibraryData["source"] = { kind: "consumer", author: "consumer", license: "MIT", id: "card-consumer" };
  const emptyValues: LibraryData = { source, fills: [], adoptedAt: "2026-10-30" };
  const library = applyLibraryChange(values, emptyValues, { baseHash: libraryHash(emptyValues), changes });
  const profile = resolve({ catalog: values, library });
  const tokens = Object.fromEntries([...emittedTokenProperties(profile)].map(([id, output]) => {
    let member = profile.members[id]!;
    while (member.alias.light) member = profile.members[member.alias.light]!;
    return [id, { property: output.property, light: member.css.light }];
  }));
  const catalog = { slots: registry.slots, fills: bundles.componentFills };
  const plan = planComponentDefaults({ catalog, slots: ["components.card"], tokens, assets: [], installedRac: installedHeadlessLibrary(), bundles: bundles.sourceBundles, preference: ["shadcn@aria", "foundry"] });
  expect(plan.rows).toContainEqual(expect.objectContaining({ slot: "components.card", status: "default", source: "shadcn@aria" }));
  const empty: CompositeLibraryData = { source, adoptedAt: "2026-10-30", values: { fills: [] }, components: { fills: [], files: [] } };
  const adopted = applyDecisions({ values, components: catalog }, empty, plan.decisions, { bundles: bundles.sourceBundles });
  const fill = componentOf(adopted.components.fills.find(doc => componentOf(doc).slot === "components.card")!);
  expect(fill.impl).toEqual({ kind: "source", entry: "components/card/card.tsx", export: "Card" });
  const file = adopted.components.files.find(file => file.path === "components/card/card.tsx")!;
  const fixture = JSON.parse(readFileSync(pathResolve(import.meta.dirname, "../importers/__fixtures__/shadcn-aria/card.json"), "utf8"));
  expect(file.content).toBe(fixture.files[0].content.replace('from "cn"', 'from "../_parts/utils/index.js"'));
});
