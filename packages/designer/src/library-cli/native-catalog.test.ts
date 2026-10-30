// @vitest-environment node
import { expect, it } from "vitest";
import { applyLibraryChange, libraryHash, loadBuildCatalog, type LibraryData } from "../catalog-core/index.js";
import { flatten } from "../catalog-core/model.js";
import { applyAgentChange } from "./reselect.js";
import { loadNativeCompositeCatalog, loadNativeDefaultSources } from "./native-catalog.js";

const requestedTokens = [
  "blur", "body-size", "border-color", "border-width", "breakpoint", "caption-size", "content-size", "control-radius",
  "letter-spacing", "line-height", "spacing", "status-color", "surface-color", "touch-target", "typeface", "z-index",
].map(leaf => `tokens.${leaf}`);
const empty = (): LibraryData => ({
  source: { id: "candidate-consumer", kind: "consumer", author: "consumer", license: "UNLICENSED" },
  adoptedAt: "2026-10-30", fills: [],
});

it.each(requestedTokens)("reselects %s from the requested source with native member coverage", async leaf => {
  const catalog = loadNativeCompositeCatalog();
  let library = empty();
  // Status tints are translucent; the native contrast checker needs their real surface backdrop.
  if (leaf === "tokens.status-color") library = applyLibraryChange(catalog.values, library, {
    baseHash: libraryHash(library), changes: [{ op: "adopt", slot: "tokens.surface-color", source: "shadcn@aria" }],
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

it("preserves approved authored semantic roles and aliases beside upstream scale values", () => {
  const catalog = loadNativeCompositeCatalog(), library = empty();
  const adopted = applyLibraryChange(catalog.values, library, {
    baseHash: libraryHash(library), changes: ["tokens.typeface", "tokens.content-size", "tokens.breakpoint", "tokens.blur", "tokens.spacing"].map(slot => ({ op: "adopt" as const, slot, source: "shadcn@aria" })),
  });
  const members = Object.assign({}, ...adopted.fills.map(flatten));
  expect(members["tokens.typeface.display"].$value).toBe("{tokens.typeface.body}");
  expect(members["tokens.content-size.display"].$value).toBe("{tokens.content-size.wide}");
  expect(members["tokens.content-size.dock-default"].$value).toEqual({ unit: "px", value: 240 });
  expect(members["tokens.breakpoint.mobile"].$value).toEqual({ unit: "px", value: 375 });
  expect(members["tokens.blur.glass"].$value).toEqual({ unit: "px", value: 20 });
  expect(members["tokens.blur.glass"].$extensions["com.clossys.provenance"].sourceLabel).toBe("Foundry-authored");
  expect(members["tokens.spacing.md"].$extensions["com.clossys.provenance"].sourceLabel).toBe("Tailwind4.3.3");
});

it("reselects an existing known source through the shared native catalog without changing the input", async () => {
  const leaf = "tokens.blur", source = "foundry";
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
  expect(policy["tokens.spacing"]).toBe("shadcn@aria");
  expect(policy["tokens.content-size"]).toBe("shadcn@aria");
  expect(policy["assets.icon-home"]).toBeUndefined();
  expect(policy["tokens.unknown"]).toBeUndefined();
});

it("does not infer a source from an existing candidate when the native policy is unknown", () => {
  const build = loadBuildCatalog(), catalog = loadNativeCompositeCatalog();
  expect(catalog.values.fills.some(fill => fill.$extensions["com.clossys.fill"].slot === "assets.icon-home")).toBe(true);
  expect(loadNativeDefaultSources(build)["assets.icon-home"]).toBeUndefined();
});
