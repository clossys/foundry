import { describe, expect, it } from "vitest";
import { litSet, type UsageEdge } from "./graph.js";

// frame uses section uses component uses token; a sibling component also uses the token.
const edges: UsageEdge[] = [
  { from: "frames.shell", to: "sections.band" },
  { from: "sections.band", to: "components.button" },
  { from: "components.button", to: "themes.spacing" },
  { from: "components.menu", to: "themes.spacing" },
];

describe("system canvas lit set", () => {
  it("lights what the selection uses, transitively down [mutant: one hop]", () => {
    expect([...litSet(edges, "frames.shell")].sort()).toEqual(["components.button", "frames.shell", "sections.band", "themes.spacing"]);
  });

  it("lights what uses the selection, transitively up [mutant: one hop]", () => {
    expect([...litSet(edges, "themes.spacing")].sort()).toEqual(["components.button", "components.menu", "frames.shell", "sections.band", "themes.spacing"]);
  });

  it("lights both directions from a middle leaf but never a sibling reached down-then-up", () => {
    expect([...litSet(edges, "components.button")].sort()).toEqual(["components.button", "frames.shell", "sections.band", "themes.spacing"]);
  });

  it("lights only the selection with no edges, and nothing with no selection", () => {
    expect([...litSet([], "components.button")]).toEqual(["components.button"]);
    expect(litSet(edges, undefined).size).toBe(0);
  });

  it("terminates on a cycle", () => {
    expect([...litSet([{ from: "a", to: "b" }, { from: "b", to: "a" }], "a")].sort()).toEqual(["a", "b"]);
  });
});
