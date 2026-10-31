// @vitest-environment node
import { expect, it } from "vitest";
import { applyLibraryChange, libraryHash, loadBuildCatalog, type LibraryData } from "../catalog-core/index.js";
import type { CompositeLibraryData } from "../catalog-core/types.js";
import { flatten } from "../catalog-core/model.js";
import { applyAgentChange } from "./reselect.js";
import { loadNativeCompositeCatalog, loadNativeDefaultSources } from "./native-catalog.js";

const requestedTokens = [
  "accent", "background", "border", "card", "chart-1", "destructive", "foreground", "input",
  "muted", "primary", "primary-foreground", "radius", "ring", "secondary", "sidebar", "sidebar-ring",
].map(leaf => `themes.${leaf}`);
const empty = (): LibraryData => ({
  source: { id: "candidate-consumer", kind: "consumer", author: "consumer", license: "UNLICENSED" },
  adoptedAt: "2026-10-30", fills: [],
});

it.each(requestedTokens)("reselects %s from the requested source with native member coverage", async leaf => {
  const catalog = loadNativeCompositeCatalog();
  let library = empty();
  // The native contrast checker reads destructive against its real surface backdrop.
  if (leaf === "themes.destructive") library = applyLibraryChange(catalog.values, library, {
    baseHash: libraryHash(library), changes: [{ op: "adopt", slot: "themes.background", source: "shadcn@aria" }],
  });
  const prior = structuredClone(library);
  const result = await applyAgentChange(
    { root: "", catalog, leaf, write: false }, library,
    { op: "adopt", slot: leaf, source: "shadcn@aria" },
    { command: "designer-library reselect", inputs: { leaf, source: "shadcn@aria" } },
  );
  expect(result.verdict.findings.filter(finding => finding.severity === "error")).toEqual([]);
  expect(result.verdict.ok).toBe(true);
  expect(library).toEqual(prior);
  const adopted = applyLibraryChange(catalog.values, library, {
    baseHash: libraryHash(library), changes: [{ op: "adopt", slot: leaf, source: "shadcn@aria" }],
  });
  const candidate = catalog.values.fills.find(fill => fill.$extensions["com.clossys.fill"].slot === leaf && fill.$extensions["com.clossys.fill"].source === "shadcn@aria")!;
  const members = Object.assign({}, ...adopted.fills.map(flatten));
  for (const [id, token] of Object.entries(flatten(candidate))) {
    expect(token.$extensions?.["com.clossys.provenance"], `${id} value-source attribution`).toBeDefined();
    expect(members[id].$extensions["com.clossys.provenance"]).toEqual(token.$extensions!["com.clossys.provenance"]);
    expect(members[id].$extensions["com.clossys.origin"]).toMatchObject({ kind: "adopted", source: "shadcn@aria" });
  }
});

it("adopts each theme from its single native source with aliases and upstream values intact", () => {
  const catalog = loadNativeCompositeCatalog(), library = empty(), policy = loadNativeDefaultSources(loadBuildCatalog());
  const slots = ["themes.font-sans", "themes.font-heading", "themes.spacing", "themes.radius", "themes.animate-marquee"];
  const adopted = applyLibraryChange(catalog.values, library, {
    baseHash: libraryHash(library), changes: slots.map(slot => ({ op: "adopt" as const, slot, source: policy[slot]! })),
  });
  const members = Object.assign({}, ...adopted.fills.map(flatten));
  expect(members["themes.font-heading.default"].$value).toBe("{themes.font-sans.default}");
  expect(members["themes.spacing.default"].$value).toEqual({ unit: "rem", value: 0.25 });
  expect(members["themes.radius.default"].$value).toEqual({ unit: "rem", value: 0.625 });
  expect(members["themes.animate-marquee.default"].$extensions["com.clossys.origin"]).toMatchObject({ kind: "adopted", source: "foundry" });
  expect(members["themes.radius.default"].$extensions["com.clossys.provenance"].sourceLabel).toBe("shadcn");
});

it("reselects an existing known source through the shared native catalog without changing the input", async () => {
  const leaf = "themes.animate-marquee", source = "foundry";
  const catalog = loadNativeCompositeCatalog();
  const library: LibraryData = {
    source: { id: "candidate-consumer", kind: "consumer", author: "consumer", license: "UNLICENSED" },
    adoptedAt: "2026-10-30", fills: [],
  };
  const result = await applyAgentChange(
    { root: "", catalog, leaf, write: false }, library,
    { op: "adopt", slot: leaf, source },
    { command: "designer-library reselect", inputs: { leaf, source } },
  );
  expect(result.verdict.findings.filter(finding => finding.severity === "error")).toEqual([]);
  expect(result.verdict.ok).toBe(true);
  expect(library.fills).toEqual([]);
  const selected = catalog.values.fills.find(fill => {
    const meta = fill.$extensions["com.clossys.fill"];
    return meta.slot === leaf && meta.source === source;
  });
  expect(selected, `${leaf} requested source candidate`).toBeDefined();
  expect(Object.keys(flatten(selected!)).length).toBeGreaterThan(0);
});

it("reads explicit native source policy and leaves ambiguous or absent policy undefined", () => {
  const policy = loadNativeDefaultSources(loadBuildCatalog());
  expect(policy["components.button"]).toBe("shadcn@aria");
  expect(policy["components.rich-text"]).toBe("shadcn@aria");
  expect(policy["components.semantic-content"]).toBe("foundry");
  expect(policy["components.native-action"]).toBe("foundry");
  expect(policy["themes.background"]).toBe("shadcn@aria");
  expect(policy["themes.radius"]).toBe("shadcn@aria");
  expect(policy["themes.spacing"]).toBe("tailwind-default");
  expect(policy["themes.shadow"]).toBe("tailwind-default");
  expect(policy["themes.animate-marquee"]).toBe("foundry");
  expect(policy["assets.icon-home"]).toBeUndefined();
  expect(policy["themes.unknown"]).toBeUndefined();
});

it("adopts and reselects the existing RichText package candidate with its source attribution", () => {
  const catalog = loadNativeCompositeCatalog(), slot = "components.rich-text";
  const initial: CompositeLibraryData = { ...empty(), values: { fills: [] }, components: { fills: [], files: [] } };
  const adopt = (library: CompositeLibraryData) => applyLibraryChange(catalog, library, {
    baseHash: libraryHash(library),
    changes: [
      ...["components.badge", "components.link", "components.semantic-content", "components.checkbox", "components.table"].map(dependency => ({ portion: "components" as const, change: { op: "adopt" as const, slot: dependency, source: "foundry" } })),
      { portion: "components", change: { op: "adopt", slot, source: "shadcn@aria" } },
    ],
  });
  const adopted = adopt(initial), selected = adopted.components.fills.find(doc => doc.$extensions["com.clossys.fill"].slot === slot)!.components["rich-text"]!;
  expect(selected.origin).toMatchObject({ kind: "adopted", source: "shadcn@aria", fill: "shadcn@aria/components.rich-text", license: "MIT" });
  expect(selected.impl).toEqual({ kind: "package", module: "@clossys/designer/components", export: "RichText" });
  expect(adopted.components.files).toEqual([]);
  expect(adopt(adopted)).toEqual(adopted);
  expect(initial.components.fills).toEqual([]);
});

it("does not infer a source from an existing candidate when the native policy is unknown", () => {
  const build = loadBuildCatalog(), catalog = loadNativeCompositeCatalog();
  expect(catalog.values.fills.some(fill => fill.$extensions["com.clossys.fill"].slot === "assets.icon-home")).toBe(true);
  expect(loadNativeDefaultSources(build)["assets.icon-home"]).toBeUndefined();
});
