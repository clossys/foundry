import { describe, expect, it } from "vitest";
import type { CanvasInstanceBinding, InstanceBinding } from "./instance-binding.js";
import { instanceBodyFindings } from "./instance-body.js";
import { syntheticRoute, SYNTHETIC_ROUTE_REGISTRIES } from "./__fixtures__/registered-route.js";
const flow = () => structuredClone(syntheticRoute().composition.binding);
const canvas = (): CanvasInstanceBinding => {
  const { layout: _layout, body: _body, ...binding } = flow();
  return { ...binding, body: { kind: "canvas", source: { kind: "static" }, collapseBelow: "tokens.breakpoint.mobile", boards: [{ id: "tools", section: { slot: "body", index: 0 }, groups: { category: "tools" } }], arrangement: { kind: "grid", columns: 2, gap: { x: 8, y: 8 } } } };
};
const registries = { ...SYNTHETIC_ROUTE_REGISTRIES, sections: SYNTHETIC_ROUTE_REGISTRIES.sections.map(section => ({ ...section, contract: { ...section.contract, substrates: ["flow", "canvas"] as const, substrateTests: [{ substrate: "flow" as const, file: "SYNTHETIC.tsx", name: "SYNTHETIC flow" }, { substrate: "canvas" as const, file: "SYNTHETIC.tsx", name: "SYNTHETIC canvas" }] } })) };
describe("closed canonical InstanceBinding body schema (synthetic declaration tests)", () => {
  it("preserves reference identity and accepts declared flow/canvas without a dummy canvas Layout", () => {
    expect(instanceBodyFindings(flow(), registries)).toEqual([]);
    expect(instanceBodyFindings(canvas(), registries)).toEqual([]);
  });
  it.each(["board-position", "body-extra", "source-extra", "query-extra", "arrangement-extra", "gap-extra", "groups-array", "layout", "duplicate", "unknown", "missing", "ref-extra", "binding-extra", "fill-extra", "malformed"])("rejects %s data before generic substrate validation", mutation => {
    const binding = canvas(); const body = binding.body;
    if (mutation === "board-position") Object.assign(body.boards[0]!, { x: 100, y: 200 });
    if (mutation === "body-extra") Object.assign(body, { status: "built" });
    if (mutation === "source-extra") Object.assign(body.source, { extra: "unbound" });
    if (mutation === "query-extra") Object.assign(body, { source: { kind: "derived", query: { id: "example.boards", version: 1, extra: true } } });
    if (mutation === "arrangement-extra") Object.assign(body.arrangement, { positions: {} });
    if (mutation === "gap-extra") Object.assign(body.arrangement, { gap: { x: 8, y: 8, extra: true } });
    if (mutation === "groups-array") Object.assign(body.boards[0]!, { groups: [] });
    if (mutation === "layout") Object.assign(binding, { layout: { leaf: "layouts.stack", config: "stack.focus" } });
    if (mutation === "duplicate") Object.assign(body, { boards: [...body.boards, { ...body.boards[0]!, id: "second" }] });
    if (mutation === "unknown") Object.assign(body.boards[0]!, { section: { slot: "other", index: 0 } });
    if (mutation === "missing") Object.assign(body, { boards: [] });
    if (mutation === "ref-extra") Object.assign(body.boards[0]!.section, { section: "sections.content" });
    if (mutation === "binding-extra") Object.assign(binding, { status: "reviewed" });
    if (mutation === "fill-extra") Object.assign(binding.fills.body![0]!, { reviewed: true });
    if (mutation === "malformed") Object.assign(body, { boards: [null] });
    expect(instanceBodyFindings(binding as InstanceBinding, registries).length).toBeGreaterThan(0);
  });
  it("requires actual substrate declarations and named render tests", () => {
    expect(instanceBodyFindings(canvas(), SYNTHETIC_ROUTE_REGISTRIES).some(finding => finding.includes("canvas"))).toBe(true);
    const noTest = { ...registries, sections: registries.sections.map(section => ({ ...section, contract: { ...section.contract, substrateTests: [] } })) };
    expect(instanceBodyFindings(canvas(), noTest).length).toBeGreaterThan(0);
  });
  it("validates authored flow descendants recursively and refuses child escapes, cycles and canvas nesting", () => {
    const binding = flow(), child = structuredClone(binding.fills.body![0]!);
    Object.assign(binding.fills.body![0]!, { children: [child] });
    expect(instanceBodyFindings(binding, registries)).toEqual([]);
    Object.assign(child, { render: "host body" });
    expect(instanceBodyFindings(binding, registries)).toContain("Section fill/content has unknown fields");
    delete (child as unknown as Record<string, unknown>).render;
    Object.assign(child, { children: [child] });
    expect(instanceBodyFindings(binding, registries)).toContain("Section nesting must be bounded and acyclic");
    const board = canvas(); Object.assign(board.fills.body![0]!, { children: [structuredClone(flow().fills.body![0]!)] });
    expect(instanceBodyFindings(board, registries)).toContain("Nested Sections require a non-empty authored flow list");
  });
});
