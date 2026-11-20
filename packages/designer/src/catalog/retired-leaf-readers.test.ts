import { describe, expect, it } from "vitest";
import retired from "./retired.json" with { type: "json" };
import sectionHomes from "./maps/blocks-to-sections.json" with { type: "json" };
import { COMPONENT_ALIASES } from "./component-aliases.js";
import { retiredLeafIds } from "../catalog-core/retired-leaves.js";
import type { Retired } from "../catalog-core/types.js";

// The retired-leaf list is the oracle: a live reader never resolves an address to a leaf that is no longer offered.
const RETIRED = retiredLeafIds(retired as readonly Retired[]);
const onRetired = (map: Readonly<Record<string, string>>) => Object.entries(map).filter(([, leaf]) => RETIRED.has(leaf));

describe("live readers resolve only to live leaves", () => {
  it("has a non-empty retired-leaf oracle", () => {
    expect(RETIRED.size).toBeGreaterThan(0);
  });

  it("resolves no component alias to a retired leaf", () => {
    expect(onRetired(COMPONENT_ALIASES)).toEqual([]);
  });

  it("homes no legacy block on a retired section leaf", () => {
    expect(onRetired(sectionHomes)).toEqual([]);
  });
});
