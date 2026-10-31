import { describe, expect, it } from "vitest";
import frameSlots from "../catalog/slots/frames.json" with { type: "json" };
import { arrangeCanvas, assertCanvasArrangement, bodySubstrateFindings, type CanvasBoard, type CompositionBody } from "./body-substrate.js";
const boards: readonly CanvasBoard<string>[] = [
  { id: "color", section: "sections.comparison", groups: { domain: "paint" } },
  { id: "size", section: "sections.comparison", groups: { domain: "dimension" } },
  { id: "surface", section: "sections.comparison", groups: { domain: "paint" } },
  { id: "radius", section: "sections.comparison", groups: { domain: "dimension" } },
];
const sizes = { color: { width: 100, height: 30 }, size: { width: 20, height: 90 }, surface: { width: 40, height: 50 }, radius: { width: 70, height: 10 } };
const grid = { kind: "grid" as const, columns: 2, gap: { x: 10, y: 5 } };
const lanes = { kind: "lanes" as const, groupKey: "domain", gap: { x: 10, y: 5 }, laneGap: 15 };
const stage = { accepts: ["flow", "canvas"] as const, scroll: "region" as const };
// Synthetic contract fixtures exercise validation only; no consumer rendering is claimed.
const contract = () => ({ substrates: ["flow", "canvas"] as const, substrateTests: [
  { substrate: "flow" as const, file: "section.render.test.tsx", name: "renders in flow" },
  { substrate: "canvas" as const, file: "section.render.test.tsx", name: "renders in canvas" },
] });
const canvas: CompositionBody<string> = { kind: "canvas", source: { kind: "derived", query: { id: "library.layer-boards", version: 1 } }, boards, arrangement: lanes, collapseBelow: "md" };
describe("pure measured canvas arrangement", () => {
  it("sizes grid tracks by column and row maxima and bounds by actual content", () => {
    expect(arrangeCanvas(boards, sizes, grid)).toEqual({ status: "ready", positions: [
      { id: "color", x: 0, y: 0, width: 100, height: 30 },
      { id: "size", x: 110, y: 0, width: 20, height: 90 },
      { id: "surface", x: 0, y: 95, width: 40, height: 50 },
      { id: "radius", x: 110, y: 95, width: 70, height: 10 },
    ], bounds: { x: 0, y: 0, width: 180, height: 145 }, readingOrder: ["color", "size", "surface", "radius"] });
  });
  it("lanes group by explicit key in stable first-seen order and top-align contents", () => {
    expect(arrangeCanvas(boards, sizes, lanes)).toEqual({ status: "ready", positions: [
      { id: "color", x: 0, y: 0, width: 100, height: 30 },
      { id: "surface", x: 110, y: 0, width: 40, height: 50 },
      { id: "size", x: 0, y: 70, width: 20, height: 90 },
      { id: "radius", x: 30, y: 70, width: 70, height: 10 },
    ], bounds: { x: 0, y: 0, width: 150, height: 160 }, readingOrder: ["color", "surface", "size", "radius"] });
  });
  it("switches grid and lanes without changing any Section or input object", () => {
    const input = structuredClone({ boards, sizes });
    const first = arrangeCanvas(boards, sizes, grid), second = arrangeCanvas(boards, sizes, lanes);
    expect(first).not.toEqual(second);
    expect(arrangeCanvas(boards, sizes, grid)).toEqual(first);
    expect({ boards, sizes }).toEqual(input);
    if (first.status !== "ready" || second.status !== "ready") throw new Error("computed arrangement unavailable");
    expect(first.positions.map(p => p.id).sort()).toEqual(second.positions.map(p => p.id).sort());
  });
  it("handles no boards and incomplete rows without synthetic content or empty trailing tracks", () => {
    expect(arrangeCanvas([], {}, grid)).toEqual({ status: "ready", positions: [], bounds: { x: 0, y: 0, width: 0, height: 0 }, readingOrder: [] });
    const result = arrangeCanvas(boards.slice(0, 1), { color: sizes.color }, { ...grid, columns: 900 });
    expect(result.status === "ready" && result.bounds).toEqual({ x: 0, y: 0, width: 100, height: 30 });
  });
  it("refuses missing/stale/zero/nonfinite measurements and malformed configuration", () => {
    expect(() => arrangeCanvas(boards, {}, grid)).toThrow("measured board size missing");
    expect(() => arrangeCanvas(boards, { ...sizes, orphan: sizes.color }, grid)).toThrow("unknown board");
    for (const width of [0, -1, Infinity, NaN]) expect(() => arrangeCanvas(boards, { ...sizes, color: { width, height: 30 } }, grid)).toThrow("measured width");
    expect(() => arrangeCanvas(boards, sizes, { ...grid, columns: 0 })).toThrow("columns");
    expect(() => arrangeCanvas(boards, sizes, { ...grid, gap: { x: -1, y: 0 } })).toThrow("gap.x");
    expect(() => arrangeCanvas([boards[0]!, boards[0]!], sizes, grid)).toThrow("duplicate board");
    expect(() => arrangeCanvas(boards, sizes, { ...lanes, groupKey: "absent" })).toThrow("groupKey data");
    expect(() => arrangeCanvas(boards, sizes, { ...grid, positions: {} } as typeof grid)).toThrow("cannot store positions");
    expect(() => arrangeCanvas(boards, { ...sizes, color: { width: Number.MAX_VALUE, height: 30 }, size: { width: Number.MAX_VALUE, height: 90 } }, grid)).toThrow("overflow");
  });
  it("never reports contract-only graph or freeform as executable geometry", () => {
    expect(arrangeCanvas(boards, sizes, { kind: "graph", edges: [], direction: "down", gap: { x: 0, y: 0 } })).toEqual({ status: "unavailable", kind: "graph", reason: "not-implemented" });
    const positions = Object.fromEntries(boards.map(board => [board.id, { x: 0, y: 0 }]));
    expect(arrangeCanvas(boards, sizes, { kind: "freeform", positions, orphanRule: "reject" })).toEqual({ status: "unavailable", kind: "freeform", reason: "not-implemented" });
    expect(() => assertCanvasArrangement(boards, { kind: "graph", direction: "down", gap: { x: 0, y: 0 } } as never)).toThrow("edges required");
    expect(() => assertCanvasArrangement(boards, { kind: "graph", edges: [{ id: "edge", from: "color", to: "missing" }], direction: "down", gap: { x: 0, y: 0 } })).toThrow("endpoint");
    expect(() => assertCanvasArrangement(boards, { kind: "freeform", positions } as never)).toThrow("orphanRule");
    expect(() => assertCanvasArrangement(boards, { kind: "freeform", positions: {}, orphanRule: "drop" })).toThrow("stable board id");
    expect(() => assertCanvasArrangement(boards, { kind: "freeform", positions: { ...positions, orphan: { x: 0, y: 0 } }, orphanRule: "reject" })).toThrow("orphan");
    expect(() => assertCanvasArrangement(boards, { kind: "freeform", positions: { ...positions, orphan: { x: 0, y: 0 } }, orphanRule: "drop" })).not.toThrow();
  });
});
describe("body and stage compatibility preconditions", () => {
  it("declares one workspace Stage contract without creating Frame leaves or configurations", () => {
    const workspace = frameSlots.find(frame => frame.id === "frames.app-shell")!;
    expect(workspace.contract.stage).toEqual(stage);
    expect(frameSlots.some(frame => frame.id === "frames.admin-shell")).toBe(false);
    expect(workspace.contract.members.names).not.toContain("substrate.canvas");
  });
  it("accepts both body kinds against one stage without implying runtime qualification", () => {
    expect(bodySubstrateFindings(canvas, stage, contract)).toEqual([]);
    expect(bodySubstrateFindings({ kind: "flow", source: { kind: "static" }, sections: ["sections.comparison"] }, stage, contract)).toEqual([]);
  });
  it("refuses flow-only Sections or a canvas body in a flow-only stage", () => {
    expect(bodySubstrateFindings(canvas, stage, () => ({ substrates: ["flow"] }))).toContain("Section 0 does not declare canvas support");
    expect(bodySubstrateFindings(canvas, { accepts: ["flow"], scroll: "region" }, contract)).toContain("Frame stage does not accept body substrate");
    expect(bodySubstrateFindings(canvas, undefined, () => undefined)).toContain("Frame stage scroll contract unavailable");
    expect(bodySubstrateFindings(canvas, stage, () => ({ substrates: ["flow", "canvas"] }))).toContain("Section 0 lacks a named canvas render test");
    expect(bodySubstrateFindings({ ...canvas, boards: [null] } as never, stage, contract)).toContain("board must name its Section");
  });
  it("requires versioned derivation, explicit fallback token and the correct body data", () => {
    expect(bodySubstrateFindings({ ...canvas, source: { kind: "derived", query: { id: "", version: 0 } } }, stage, contract)).toContain("derived body requires a versioned query id");
    expect(bodySubstrateFindings({ ...canvas, collapseBelow: "900px" } as never, stage, contract)).toContain("canvas fallback requires an explicit Tailwind breakpoint");
    expect(bodySubstrateFindings({ kind: "flow", source: { kind: "static" }, sections: [], arrangement: grid } as never, stage, contract)).toContain("flow body cannot carry canvas data");
  });
});
