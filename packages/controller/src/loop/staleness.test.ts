import { describe, expect, it } from "vitest";
import { affectedCapabilities, changedInputs, fingerprintInputs, isStale } from "./staleness.js";

describe("fingerprinting", () => {
  it("produces the same digest for the same content, and a different one for different content", () => {
    const a = fingerprintInputs([{ path: "clossys/advisor/brief.json", content: "same" }]);
    const b = fingerprintInputs([{ path: "clossys/advisor/brief.json", content: "same" }]);
    const c = fingerprintInputs([{ path: "clossys/advisor/brief.json", content: "different" }]);
    expect(a).toEqual(b);
    expect(a["clossys/advisor/brief.json"]).not.toBe(c["clossys/advisor/brief.json"]);
  });

  it("fingerprints every supplied input independently", () => {
    const result = fingerprintInputs([
      { path: "a.json", content: "one" },
      { path: "b.json", content: "two" },
    ]);
    expect(Object.keys(result).sort()).toEqual(["a.json", "b.json"]);
  });
});

describe("staleness", () => {
  it("is not stale when every fingerprint matches", () => {
    const recorded = fingerprintInputs([{ path: "a.json", content: "one" }]);
    expect(isStale(recorded, recorded)).toBe(false);
  });

  it("is stale when a recorded input's content changed", () => {
    const recorded = fingerprintInputs([{ path: "a.json", content: "one" }]);
    const current = fingerprintInputs([{ path: "a.json", content: "two" }]);
    expect(isStale(recorded, current)).toBe(true);
  });

  it("is stale when a recorded input disappeared", () => {
    const recorded = fingerprintInputs([{ path: "a.json", content: "one" }]);
    expect(isStale(recorded, {})).toBe(true);
  });

  it("is stale when a new input appeared that was not recorded before", () => {
    const recorded = fingerprintInputs([{ path: "a.json", content: "one" }]);
    const current = fingerprintInputs([
      { path: "a.json", content: "one" },
      { path: "b.json", content: "new" },
    ]);
    expect(isStale(recorded, current)).toBe(true);
  });

  it("names exactly the changed, added, and removed paths, in sorted order", () => {
    const recorded = fingerprintInputs([
      { path: "a.json", content: "one" },
      { path: "b.json", content: "two" },
    ]);
    const current = fingerprintInputs([
      { path: "a.json", content: "one" },
      { path: "b.json", content: "changed" },
      { path: "c.json", content: "new" },
    ]);
    expect(changedInputs(recorded, current)).toEqual(["b.json", "c.json"]);
  });
});

describe("change propagation", () => {
  it("propagates only to capabilities that declared the changed path as their own input", () => {
    const result = affectedCapabilities(["clossys/advisor/brief.json"], {
      "cap-reads-brief": ["clossys/advisor/brief.json"],
      "cap-unrelated": ["clossys/strategist/direction.json"],
    });
    expect(result).toEqual(["cap-reads-brief"]);
  });

  it("never affects a capability with no declared inputs", () => {
    const result = affectedCapabilities(["clossys/advisor/brief.json"], { "cap-no-inputs": [] });
    expect(result).toEqual([]);
  });

  it("returns capability ids sorted, independent of declaration order", () => {
    const result = affectedCapabilities(["x.json"], { "z-cap": ["x.json"], "a-cap": ["x.json"] });
    expect(result).toEqual(["a-cap", "z-cap"]);
  });
});
