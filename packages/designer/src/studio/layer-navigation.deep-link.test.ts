// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LayerId } from "../catalog-core/index.js";
import { normaliseStudioUrl, normaliseWindowLocation, replaceStudioLocation, resolverFromPlacements, STUDIO_LAYERS, studioUrlFor, type StudioNodeResolver } from "./layer-navigation.js";
import { smallCatalog } from "./__fixtures__/studio.js";

const KNOWN: Readonly<Record<string, LayerId>> = { "tokens.accent-color": "tokens", "tokens/color": "tokens", "components.button": "components", "components/actions": "components", "frames.app": "frames" };
const resolver: StudioNodeResolver = { layers: STUDIO_LAYERS, layerOf: node => KNOWN[node] };
const url = (search: string, hash = "") => ({ search, hash });

/** Inventory (c): one test per route row. The canonical form is ?layer=<id>&node=<leaf>, both optional. */
describe("studio URL normalise table (?layer=&node=)", () => {
  it("row 1: no params stay unchanged", () => {
    expect(normaliseStudioUrl(url(""), resolver)).toEqual({ search: "", hash: "", location: {}, changed: false });
  });
  it("row 2: ?layer=X is kept", () => {
    expect(normaliseStudioUrl(url("?layer=frames"), resolver)).toEqual({ search: "?layer=frames", hash: "", location: { layer: "frames" }, changed: false });
  });
  it("row 3: the legacy #studio-layer=X fragment becomes ?layer=X", () => {
    expect(normaliseStudioUrl(url("", "#studio-layer=assets"), resolver)).toEqual({ search: "?layer=assets", hash: "", location: { layer: "assets" }, changed: true });
    // The fragment was the active layer: it wins over a stale query layer.
    expect(normaliseStudioUrl(url("?layer=sections", "#studio-layer=assets"), resolver).search).toBe("?layer=assets");
  });
  it("row 4: the D5f ?node=<leaf> derives its layer", () => {
    expect(normaliseStudioUrl(url("?node=components.button"), resolver)).toEqual({ search: "?layer=components&node=components.button", hash: "", location: { layer: "components", node: "components.button" }, changed: true });
  });
  it("row 5: the D5f ?layer=X&l1=Y becomes ?layer=X&node=Y", () => {
    expect(normaliseStudioUrl(url("?layer=components&l1=components/actions"), resolver)).toEqual({ search: "?layer=components&node=components/actions", hash: "", location: { layer: "components", node: "components/actions" }, changed: true });
  });
  it("row 6: an unknown layer or node drops the param, with no error", () => {
    expect(normaliseStudioUrl(url("?layer=bogus"), resolver)).toEqual({ search: "", hash: "", location: {}, changed: true });
    expect(normaliseStudioUrl(url("?layer=tokens&node=tokens.nope"), resolver)).toEqual({ search: "?layer=tokens", hash: "", location: { layer: "tokens" }, changed: true });
    expect(normaliseStudioUrl(url("", "#studio-layer=bogus"), resolver)).toEqual({ search: "", hash: "", location: {}, changed: true });
    expect(normaliseStudioUrl(url("?layer=components&l1=nope"), resolver).search).toBe("?layer=components");
    // A layer the host does not offer is unknown too (a legacy studio has only its catalog's layers).
    expect(normaliseStudioUrl(url("?layer=frames"), { ...resolver, layers: ["tokens", "assets"] }).search).toBe("");
  });
  it("keeps unrelated params and fragments, and a node's own layer wins over a mismatched one", () => {
    expect(normaliseStudioUrl(url("?a=1&layer=tokens", "#top"), resolver)).toEqual({ search: "?a=1&layer=tokens", hash: "#top", location: { layer: "tokens" }, changed: false });
    expect(normaliseStudioUrl(url("?layer=tokens&node=frames.app"), resolver).search).toBe("?layer=frames&node=frames.app");
  });
});

describe("selection writes the canonical URL", () => {
  it("writes layer and node, dropping legacy forms", () => {
    expect(studioUrlFor(url("?a=1&l1=x", "#studio-layer=assets"), { layer: "components", node: "components.button" })).toEqual({ search: "?a=1&layer=components&node=components.button", hash: "" });
    expect(studioUrlFor(url("?layer=components&node=components.button"), { layer: "tokens" })).toEqual({ search: "?layer=tokens", hash: "" });
    expect(studioUrlFor(url("?layer=tokens"), {})).toEqual({ search: "", hash: "" });
  });
  it("builds a resolver from placements: tree ids resolve to their layer, others do not", () => {
    const resolve = resolverFromPlacements(smallCatalog.placements);
    expect(resolve.layers).toEqual(["tokens", "assets"]);
    expect(resolve.layerOf("tokens.surface-color")).toBe("tokens");
    expect(resolve.layerOf("assets.icon-search")).toBe("assets");
    const branch = smallCatalog.placements.find(placement => placement.layer === "tokens")!.nodes[0]!;
    expect(resolve.layerOf(`tokens/${branch.id}`)).toBe("tokens");
    expect(resolve.layerOf("tokens.accent-color")).toBeUndefined();
  });
});

describe("window location", () => {
  afterEach(() => { vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });
  it("normalises in place with replaceState and returns the location", () => {
    window.history.replaceState(null, "", "/designer?node=components.button#studio-layer=assets");
    const replace = vi.spyOn(window.history, "replaceState");
    expect(normaliseWindowLocation(resolver)).toEqual({ layer: "components", node: "components.button" });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(window.location.pathname + window.location.search + window.location.hash).toBe("/designer?layer=components&node=components.button");
  });
  it("leaves a canonical URL alone, and writes a selection with replaceState", () => {
    window.history.replaceState(null, "", "/designer?layer=tokens");
    const replace = vi.spyOn(window.history, "replaceState");
    expect(normaliseWindowLocation(resolver)).toEqual({ layer: "tokens" });
    expect(replace).not.toHaveBeenCalled();
    replaceStudioLocation({ layer: "tokens", node: "tokens.accent-color" });
    expect(window.location.search).toBe("?layer=tokens&node=tokens.accent-color");
    expect(replace).toHaveBeenCalledTimes(1);
  });
});
