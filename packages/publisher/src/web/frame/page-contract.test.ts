import { describe, expect, it } from "vitest";
import { SITE_PAGE_LAYERS } from "./index.js";

describe("SITE_PAGE_LAYERS", () => {
  it("names the nine page-assembly layers and their owners as data", () => {
    expect(SITE_PAGE_LAYERS).toEqual([
      { id: 1, name: "Request edge", owner: "Bouncer", mountOwner: "Bouncer", implementationScope: "contract-only" },
      { id: 2, name: "Document and head", owner: "Publisher", mountOwner: "Publisher", implementationScope: "supplier" },
      { id: 3, name: "Providers and runtime", owner: "Their owning packages", mountOwner: "Publisher names provider mount points", implementationScope: "contract-only" },
      { id: 4, name: "Shell and chrome", owner: "Designer", mountOwner: "Publisher frame", implementationScope: "this-unit" },
      { id: 5, name: "View", owner: "Publisher shipped views and registry", mountOwner: "Publisher frame", implementationScope: "this-unit" },
      { id: 6, name: "Per-page head", owner: "Publisher", mountOwner: "Publisher pageHead", implementationScope: "this-unit" },
      { id: 7, name: "Machine surfaces", owner: "Publisher", mountOwner: "Publisher", implementationScope: "contract-only" },
      { id: 8, name: "System states", owner: "Publisher views", mountOwner: "Publisher frame", implementationScope: "this-unit" },
      { id: 9, name: "Forms and APIs", owner: "Their owning form/API packages", mountOwner: "Explicit package adapter", implementationScope: "out-of-scope" },
    ]);
  });

  it("is deeply frozen", () => {
    expect(Object.isFrozen(SITE_PAGE_LAYERS)).toBe(true);
    for (const layer of SITE_PAGE_LAYERS) expect(Object.isFrozen(layer)).toBe(true);
    expect(() => {
      (SITE_PAGE_LAYERS as unknown as { push(value: unknown): void }).push({});
    }).toThrow(TypeError);
  });
});
