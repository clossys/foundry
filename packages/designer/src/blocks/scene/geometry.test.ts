import { describe, expect, it } from "vitest";
import { fnv1a, layoutScene, sceneRelationText } from "./geometry.js";
import type { SceneInput, SceneConverge, SceneEvidenceTrail, SceneApprovalChain } from "./types.js";

const rows = [{ id: "amount", label: "Amount", value: "12.0M" }, { id: "limit", label: "Limit", value: "15.0M" }];
const sources = ["agreement", "report", "schedule"].map(id => ({ id, format: "pdf" as const, title: id, origin: "Archive" }));
const converge: SceneConverge = { template: "converge", seed: "fixture", sources: { heading: "Documents", items: sources }, target: { heading: "Record", title: "Facility", rows }, relations: sources.map((s, i) => ({ from: s.id, to: rows[i % 2]!.id })) };
const trail: SceneEvidenceTrail = { template: "evidence-trail", seed: "fixture", sources: sources.slice(0, 2).map((s, i) => ({ ...s, cites: rows[i]!.id, cite: "p. 2" })), result: { title: "Result", rows, status: { tone: "warning", text: "Review" } } };
const chain: SceneApprovalChain = { template: "approval-chain", seed: "fixture", prepared: { heading: "Prepared" }, findings: ["first", "second"].map((id, i) => ({ id, fn: "Review", title: id, subjectOf: "Facility", status: { tone: "info", text: "Prepared" }, ...(i === 0 ? { subject: true as const } : {}) })), node: { label: "Sent for review" }, decision: { title: "Decision", rows, status: { tone: "success", text: "Decided" }, person: { initials: "RR", name: "Review role", note: "Decider" } } };

describe("scene geometry", () => {
  it("pins UTF-16 FNV-1a goldens", () => { expect(["", "hello", "fixture:agreement"].map(fnv1a)).toEqual([2166136261, 1335831723, 4039640740]); });
  it.each([converge, trail, chain])("is deterministic and responds to the explicit seed: $template", input => {
    expect(layoutScene(input)).toEqual(layoutScene(input));
    const variants = ["other", "third", "fourth"].map(seed => layoutScene({ ...input, seed }));
    expect(variants.some(v => JSON.stringify([...v.docs, ...v.cards].map(d => d.k)) !== JSON.stringify([...layoutScene(input).docs, ...layoutScene(input).cards].map(d => d.k)))).toBe(true);
  });
  it.each([converge, trail, chain])("none has zero tilt and nudge: $template", input => {
    const l = layoutScene({ ...input, disorder: "none" });
    expect([...l.docs, ...l.cards].every(p => p.k === 0 && p.nudge === 0)).toBe(true);
  });
  it("pins converge centring and unrotated receiving anchors", () => {
    const l = layoutScene({ ...converge, disorder: "none" });
    expect([l.width, l.height, l.docs[0]!.x, l.docs[0]!.y, l.cards[0]!.y]).toEqual([880, 262, 24, 40, 59]);
    expect(l.wires[0]!.path).toBe("M 288 69 C 426.6 69 426.6 155 540 155");
    for (const wire of l.wires) {
      const d = l.docs.find(p => p.id === wire.from)!;
      expect(wire.start).toEqual({ x: d.x + d.width, y: d.y + d.height / 2 });
      expect(wire.end.y).toBe(l.cards[0]!.y + 72 + rows.findIndex(r => r.id === wire.to) * 48 + 24);
    }
    expect(l.terminals).toHaveLength(2);
  });
  it("keeps four evidence sources, tags and optional person within the height", () => {
    const input = { ...trail, sources: Array.from({ length: 4 }, (_, i) => ({ ...trail.sources[i % 2]!, id: `doc-${i}` })) };
    for (const person of [undefined, chain.decision.person]) {
      const l = layoutScene({ ...input, result: { ...input.result, person } });
      expect(l.docs.every(d => d.y + d.height <= l.height)).toBe(true);
      expect(l.tags.every(t => t.y + t.height <= l.height)).toBe(true);
      expect(l.people).toHaveLength(person ? 1 : 0);
      expect(l.cards[0]!.y + l.cards[0]!.height).toBeLessThanOrEqual(l.height);
      expect(l.docs.map(d => d.y)).toEqual([80, 178, 276, 374]);
    }
  });
  it("has one subject input and one subject output into the first decision row", () => {
    const l = layoutScene(chain);
    expect(l.wires.filter(w => w.subject)).toHaveLength(2);
    expect(l.nodes[0]).toMatchObject({ x: 425, width: 150, height: 36 });
    expect(l.wires.at(-1)!.start.x).toBe(575);
    expect(l.wires.at(-1)!.end).toEqual({ x: 620, y: l.cards.at(-1)!.y + 108 });
    expect(l.terminals).toHaveLength(1);
  });
  it("uses rounded one-decimal cubic coordinates", () => { for (const w of layoutScene(converge).wires) expect(w.path).not.toMatch(/\d+\.\d{2}/); });
  it("retains every source, row and cite in relation text", () => {
    expect(sceneRelationText(converge)).toEqual(["agreement → Amount: 12.0M", "report → Limit: 15.0M", "schedule → Amount: 12.0M"]);
    expect(sceneRelationText(trail)[0]).toBe("agreement · p. 2 → Amount: 12.0M");
    expect(sceneRelationText(chain)[0]).toContain("first → Sent for review → Decision: Amount: 12.0M");
  });
  it.each([2, 9])("refuses converge source count %i", count => { expect(() => layoutScene({ ...converge, sources: { ...converge.sources, items: Array.from({ length: count }, (_, i) => ({ ...sources[0]!, id: `d${i}` })) } })).toThrow(RangeError); });
  it.each([1, 7])("refuses converge row count %i", count => { expect(() => layoutScene({ ...converge, target: { ...converge.target, rows: Array.from({ length: count }, (_, i) => ({ ...rows[0]!, id: `r${i}` })) } })).toThrow(RangeError); });
  it.each([trail, chain])("refuses template source/finding and row counts: $template", input => {
    for (const count of [1, 5]) { const bad = input.template === "evidence-trail" ? { ...input, sources: Array(count).fill(input.sources[0]) } : { ...input, findings: Array(count).fill(input.findings[0]) }; expect(() => layoutScene(bad)).toThrow(RangeError); }
    for (const count of [1, input.template === "evidence-trail" ? 6 : 5]) { const bad = input.template === "evidence-trail" ? { ...input, result: { ...input.result, rows: Array(count).fill(rows[0]) } } : { ...input, decision: { ...input.decision, rows: Array(count).fill(rows[0]) } }; expect(() => layoutScene(bad)).toThrow(RangeError); }
  });
  it("refuses dangling, duplicate, unwired, over-wired and multiple emphasis", () => {
    for (const relations of [[{ from: "missing", to: "amount" }], converge.relations.slice(1), [...converge.relations, { from: "agreement", to: "amount" }, { from: "agreement", to: "limit" }], converge.relations.map(r => ({ ...r, emphasis: true as const }))]) expect(() => layoutScene({ ...converge, relations })).toThrow(TypeError);
    expect(() => layoutScene({ ...converge, sources: { ...converge.sources, items: [sources[0]!, sources[0]!, sources[2]!] } })).toThrow(TypeError);
    expect(() => layoutScene({ ...trail, sources: trail.sources.map(s => ({ ...s, cites: "absent" })) })).toThrow(TypeError);
    expect(() => layoutScene({ ...converge, relations: Array(13).fill(converge.relations[0]) })).toThrow(RangeError);
  });
  it("refuses subject, disorder, format, status and extra geometry fields", () => {
    const bad: unknown[] = [ { ...chain, findings: chain.findings.map(f => ({ ...f, subject: undefined })) }, { ...chain, findings: chain.findings.map(f => ({ ...f, subject: true })) }, { ...trail, disorder: "medium" }, { ...converge, seed: undefined }, { ...converge, x: 10 }, { ...trail, result: { ...trail.result, status: { tone: "bogus", text: "Review" } } }, { ...trail, sources: trail.sources.map(s => ({ ...s, format: "html" })) } ];
    for (const input of bad) expect(() => layoutScene(input as SceneInput)).toThrow(TypeError);
  });
});
