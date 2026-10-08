import { describe, expect, it } from "vitest";
import { SITE_PAGE_LAYERS } from "./index.js";

describe("SITE_PAGE_LAYERS", () => {
  it("names the nine page-assembly layers and their owners as data", () => {
    expect(SITE_PAGE_LAYERS.map(({ id, name, owner, mountOwner, implementationScope }) => [id, name, owner, mountOwner, implementationScope])).toEqual([
      [1, "Request edge", "Bouncer", "Bouncer", "contract-only"],
      [2, "Document and head", "Publisher", "Publisher", "supplier"],
      [3, "Providers and runtime", "Their owning packages (telemetry contracts: Observer)", "Publisher names provider mount points", "contract-only"],
      [4, "Shell and chrome", "Designer", "Publisher frame", "implemented"],
      [5, "View", "Publisher shipped views and registry", "Publisher frame", "implemented"],
      [6, "Per-page head", "Publisher", "Publisher pageHead", "contract-only"],
      [7, "Machine surfaces", "Publisher", "Publisher", "contract-only"],
      [8, "System states", "Publisher views", "Publisher frame", "implemented"],
      [9, "Forms and APIs", "Their owning form/API packages", "Explicit package adapter", "out-of-scope"],
    ]);
  });

  it("uses only consumer-meaningful scopes and names what is deferred", () => {
    for (const layer of SITE_PAGE_LAYERS) {
      expect(["implemented", "supplier", "contract-only", "out-of-scope"]).toContain(layer.implementationScope);
    }
    const deferred = (id: number) => SITE_PAGE_LAYERS.find((layer) => layer.id === id)?.deferred;
    expect(deferred(4)).toContain("signature slot (defineSiteSignature)");
    expect(deferred(6)).toEqual(["pageHead"]);
    expect(deferred(8)).toContain("frame-aware ErrorView root");
    expect(SITE_PAGE_LAYERS.filter((layer) => layer.implementationScope === "implemented").map((layer) => layer.id)).toEqual([4, 5, 8]);
  });

  it("is deeply frozen", () => {
    expect(Object.isFrozen(SITE_PAGE_LAYERS)).toBe(true);
    for (const layer of SITE_PAGE_LAYERS) {
      expect(Object.isFrozen(layer)).toBe(true);
      expect(Object.isFrozen(layer.deferred)).toBe(true);
    }
    expect(() => {
      (SITE_PAGE_LAYERS as unknown as { push(value: unknown): void }).push({});
    }).toThrow(TypeError);
  });
});
