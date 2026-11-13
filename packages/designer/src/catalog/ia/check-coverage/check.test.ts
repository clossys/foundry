import { describe, expect, it } from "vitest";
import { checkCoverage } from "./check.js";
import { fixture, hash } from "./__fixtures__/catalog.js";

describe("bottom-up IA completeness", () => {
  it("accounts for every board/group/leaf and both directions of each connection", () => {
    const report = checkCoverage(fixture());
    expect(report.findings).toEqual([]);
    expect(report.summary.levels).toEqual({ L0: 5, L1: 5, L2: 5, L3: 5 });
    expect(report.summary.states).toEqual({ absent: 0, draft: 5, checked: 0, approved: 0 });
    const token = report.leaves.find(row => row.id === "themes.example")!;
    expect(token.usedBy).toEqual(["components.example"]);
    expect(token.uses).toEqual([]);
    expect(token.admin).toBe("reachable");
    expect(report.boards.every(board => board.registeredLeaves === 1)).toBe(true);
  });
  it("names exactly one P0 missing-leaf finding", () => {
    const input = fixture();
    input.slots = input.slots.filter(slot => slot.id !== "themes.example");
    input.fills = input.fills.filter(fill => fill.leaf !== "themes.example");
    input.edges = input.edges.filter(edge => edge.to !== "themes.example");
    expect(checkCoverage(input).findings).toEqual([expect.objectContaining({ code: "IA-MISSING-LEAF", subject: "themes.example", priority: "P0" })]);
  });
  it("names exactly one P0 dangling-reference finding", () => {
    const input = fixture(); input.edges.push({ from: "frames.example", to: "components.missing", evidence: "fixture" });
    expect(checkCoverage(input).findings).toEqual([expect.objectContaining({ code: "IA-DANGLING-REF", subject: "frames.example", target: "components.missing", priority: "P0" })]);
  });
  it("names exactly one orphan without inventing a consumer", () => {
    const input = fixture(); input.edges = input.edges.filter(edge => edge.to !== "assets.example");
    const report = checkCoverage(input);
    expect(report.findings).toEqual([expect.objectContaining({ code: "IA-ORPHAN", subject: "assets.example", priority: "P2" })]);
    expect(report.summary.orphans).toEqual(["assets.example"]);
  });
  it("reports registered leaves outside the tree", () => {
    const input = fixture(); input.slots.push({ id: "components.extra", layer: "components" });
    input.fills.push({ id: "fixture/components.extra", leaf: "components.extra", hash });
    input.edges.push({ from: "publisher:admin", to: "components.extra", evidence: "fixture" });
    expect(checkCoverage(input).findings).toEqual([expect.objectContaining({ code: "IA-UNPLACED-LEAF", subject: "components.extra", priority: "P0" })]);
  });
  it("reports a directed cycle once, including its complete membership", () => {
    const input = fixture(); input.edges.push({ from: "themes.example", to: "frames.example", evidence: "fixture" });
    expect(checkCoverage(input).summary.cycles).toEqual([["components.example", "frames.example", "sections.example", "themes.example"]]);
    expect(checkCoverage(input).findings).toEqual([expect.objectContaining({ code: "IA-CYCLE", priority: "P1" })]);
  });
  it("derives states from hash-bound check results and valid owner signoff, never a status label", () => {
    const input = fixture(); input.fills = input.fills.filter(fill => fill.leaf !== "themes.example");
    const component = input.fills.find(fill => fill.leaf === "components.example")!;
    component.checks = [{ sourceHash: hash, results: [{ code: "fixture-check", passed: true }] }];
    const section = input.fills.find(fill => fill.leaf === "sections.example")!;
    section.checks = component.checks; section.signoff = { by: "owner", date: "2026-10-28", ref: "synthetic-fixture" };
    const asset = input.fills.find(fill => fill.leaf === "assets.example")!;
    Object.assign(asset, { status: "approved", evidence: [{ check: "asserted-pass" }] });
    expect(checkCoverage(input).summary.states).toEqual({ absent: 1, draft: 2, checked: 1, approved: 1 });
    expect(checkCoverage(input).findings).toContainEqual(expect.objectContaining({ code: "IA-UNFILLED", subject: "themes.example", priority: "P1" }));
    component.checks = [{ sourceHash: `sha256:${"1".repeat(64)}`, results: [{ code: "fixture-check", passed: true }] }];
    expect(checkCoverage(input).leaves.find(row => row.id === "components.example")!.state).toBe("draft");
  });
  it("retains incomplete admin evidence as unknown and ranks unfilled known-unreachable leaves P2", () => {
    const input = fixture(); input.edges = input.edges.filter(edge => edge.to !== "assets.example");
    input.fills = input.fills.filter(fill => fill.leaf !== "assets.example");
    expect(checkCoverage(input).findings).toContainEqual(expect.objectContaining({ code: "IA-UNFILLED", subject: "assets.example", priority: "P2" }));
    input.adminInputsComplete = false;
    expect(checkCoverage(input).leaves.find(row => row.id === "assets.example")!.admin).toBe("unknown");
  });
  it("does not mutate input or key leaves by group path when regrouped", () => {
    const input = fixture(), before = structuredClone(input);
    const first = checkCoverage(input); expect(input).toEqual(before);
    input.placements[0]!.nodes[0]!.children[0]!.id = "new-family";
    const next = checkCoverage(input);
    expect(next.leaves.map(row => row.id)).toEqual(first.leaves.map(row => row.id));
    expect(next.leaves.find(row => row.id === "themes.example")!.path.l2).toBe("new-family");
  });
  it("validates inverse schema ownership without inventing a consumption cycle", () => {
    const input = fixture(); input.external!.push({ id: "writer:passages.example", package: "writer", kind: "schema" });
    input.edges.push({ from: "sections.example", to: "writer:passages.example", evidence: "fixture" }, { from: "writer:passages.example", to: "sections.example", evidence: "fixture", kind: "describes" });
    expect(checkCoverage(input).findings).toEqual([]);
  });
  it("lists dangling fill and admin-root references alongside broken graph edges", () => {
    const input = fixture(); input.fills.push({ id: "fixture/missing", leaf: "themes.missing", hash }); input.adminRoots.push("frames.missing");
    expect(checkCoverage(input).summary.dangling).toEqual(expect.arrayContaining([{ from: "fixture/missing", to: "themes.missing" }, { from: "admin", to: "frames.missing" }]));
  });
  it("does not promote a failed or empty execution record to checked", () => {
    const input = fixture(), fill = input.fills[0]!;
    fill.checks = [{ sourceHash: hash, results: [{ code: "fixture", passed: false }] }];
    expect(checkCoverage(input).leaves.find(row => row.id === fill.leaf)!.state).toBe("draft");
    fill.checks = [{ sourceHash: hash, results: [] }];
    expect(checkCoverage(input).leaves.find(row => row.id === fill.leaf)!.state).toBe("draft");
  });

  it("reports malformed IA shape without throwing or changing the registry", () => {
    const input = fixture(); Object.assign(input.placements[0]!, { nodes: [{ id: "broken", label: "Broken", children: null }] });
    expect(checkCoverage(input).findings).toContainEqual(expect.objectContaining({ code: "IA-STRUCTURE", priority: "P0" }));
  });

});
