import { describe, expect, it } from "vitest";
import type { CopyField } from "../composition.js";
import { leafRegistryFixture, reviewFixture } from "../__fixtures__/review.js";
import { stageEvidence } from "../__fixtures__/stage-engine.js";
import type { ContentRegistry } from "../model.js";
import { STAGE_STATUSES } from "../stages.js";
import { CONTENT_TREE, loadContentTree } from "../taxonomy.js";
import type { ContentTree } from "../taxonomy.js";
import { buildPublisherBoard } from "./build.js";

const stages = ["define", "assemble", "review", "approve", "publish"] as const;
function copy(registry: ContentRegistry, tree: ContentTree = CONTENT_TREE): CopyField[] {
  const keys = ["board.title", "board.canvas", "board.instructions", "board.empty", "board.no-candidate", "columns.slot", "columns.candidate",
    ...stages.map(key => `stages.${key}`), ...STAGE_STATUSES.map(key => `statuses.${key}`),
    ...tree.nodes.flatMap(node => [`tree.${node.id}`, ...node.children.map(child => `tree.${node.id}.${child.id}`)]),
    ...registry.slots.map(slot => `slot.${slot.id}.name`), ...registry.candidates.map(candidate => `candidate.${candidate.id}.name`)];
  return keys.map(key => ({ key, locale: "en", source: "writer", value: `Writer ${key}` }));
}
const rows = (model: ReturnType<typeof buildPublisherBoard>) => model.lanes.flatMap(lane => lane.groups.flatMap(group => group.rows));

describe("buildPublisherBoard", () => {
  it("uses the current tree order and preserves candidate-free slot rows honestly", () => {
    const registry = leafRegistryFixture();
    const model = buildPublisherBoard({ registry, locale: "en", copy: copy(registry) });
    expect(model.ready).toBe(true);
    expect(model.needs).toEqual([]);
    expect(model.lanes.map(lane => lane.id)).toEqual(["websites"]);
    expect(model.lanes[0]!.groups.map(group => group.l2)).toEqual(["site", "admin", "auth"]);
    expect(rows(model)).toHaveLength(18);
    for (const row of rows(model)) {
      expect(row.candidateId).toBeNull();
      expect(row.report).toBeNull();
      expect(row.active).toBe(false);
      expect(row.revision).toBeNull();
      expect(row.candidateLabel).toBe("Writer board.no-candidate");
      expect(Object.keys(row.cells)).toEqual(stages);
      expect(Object.values(row.cells)).toEqual(stages.map(() => ({ status: null, label: "Writer board.no-candidate" })));
    }
  });

  it("sorts slots by order then immutable id, and candidates by immutable id", () => {
    const source = reviewFixture();
    const slot = source.slots[0]!;
    const candidate = source.candidates[0]!;
    const registry: ContentRegistry = { ...source,
      slots: [{ ...slot, id: "sl_aaaaaaaaaa", aliases: [], activeCandidateId: undefined }, slot,
        { ...slot, id: "sl_bbbbbbbbbb", aliases: [], position: { ...slot.position, order: -1 }, activeCandidateId: undefined }],
      candidates: [{ ...candidate, id: "zulu", state: "draft" }, candidate, { ...candidate, id: "alpha", state: "draft" }],
    };
    const model = buildPublisherBoard({ registry, locale: "en", copy: copy(registry) });
    expect(model.ready).toBe(true);
    expect(rows(model).map(row => [row.slotId, row.candidateId])).toEqual([
      ["sl_bbbbbbbbbb", null], ["sl_aaaaaaaaaa", null], [slot.id, "alpha"], [slot.id, "sample"], [slot.id, "zulu"],
    ]);
  });

  it("regroups on tree reorder and changed slot placement without changing row identity or snapshots", () => {
    const registry = reviewFixture();
    const tree = loadContentTree({ schemaVersion: 1, nodes: [
      { id: "documents", label: "Unused Documents", children: [{ id: "docs", label: "Unused Docs" }] },
      { id: "websites", label: "Unused Websites", children: [{ id: "admin", label: "Unused Admin" }, { id: "site", label: "Unused Site" }] },
    ] });
    const reorderedTree = loadContentTree({ schemaVersion: 1, nodes: [...tree.nodes].reverse() });
    const additionalSlot = { ...registry.slots[0]!, id: "sl_aaaaaaaaaa" as const, l1: "documents", l2: "docs", aliases: [], activeCandidateId: undefined };
    const expanded = { ...registry, slots: [...registry.slots, additionalSlot] };
    const base = buildPublisherBoard({ registry: expanded, tree, locale: "en", copy: copy(expanded, tree) });
    const reordered = buildPublisherBoard({ registry: expanded, tree: reorderedTree, locale: "en", copy: copy(expanded, tree) });
    expect(base.lanes.map(lane => lane.id)).toEqual(["documents", "websites"]);
    expect(reordered.lanes.map(lane => lane.id)).toEqual(["websites", "documents"]);
    const moved = { ...expanded, slots: expanded.slots.map(slot => slot.id === registry.slots[0]!.id
      ? { ...slot, l1: "documents", l2: "docs", position: { order: 10, name: "new-address" } } : slot) };
    const regrouped = buildPublisherBoard({ registry: moved, tree, locale: "en", copy: copy(moved, tree) });
    expect(regrouped.ready).toBe(true);
    expect(regrouped.lanes.map(lane => lane.id)).toEqual(["documents"]);
    expect(rows(regrouped).find(row => row.candidateId === "sample")!.id).toBe(rows(base).find(row => row.candidateId === "sample")!.id);
    expect(moved.candidates).toEqual(registry.candidates);
    expect(rows(regrouped).find(row => row.candidateId === "sample")!.report!.digest).toBe(registry.candidates[0]!.history[0]!.digest);
  });

  it("does not mutate any input, including arrays sorted for presentation", () => {
    const registry = reviewFixture();
    const evidence = [stageEvidence(registry.candidates[0]!)];
    const input = { registry, tree: CONTENT_TREE, locale: "en", copy: copy(registry), evidence };
    const before = JSON.stringify(input);
    buildPublisherBoard(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("requires exact-locale Writer copy with named Needs and no prose fallback", () => {
    const registry = reviewFixture();
    const fields = copy(registry).map(field => ({ ...field, locale: "fr" }));
    const model = buildPublisherBoard({ registry, locale: "en", copy: fields });
    expect(model.ready).toBe(false);
    expect(model.needs).toContainEqual({ target: "writer", ref: "board.title", detail: expect.any(String) });
    expect(model.needs).toContainEqual({ target: "writer", ref: `slot.${registry.slots[0]!.id}.name`, detail: expect.any(String) });
    expect(model.labels.title).toBe("");
    expect(model.lanes[0]!.label).toBe("");
    expect(rows(model)[0]!.slotLabel).toBe("");
    expect(rows(model)[0]!.candidateLabel).toBe("");
    expect(JSON.stringify(model)).not.toContain('"label":"Websites"');
    expect(JSON.stringify(model)).not.toContain('"slotLabel":"Home"');
    expect(JSON.stringify(model)).not.toContain('"candidateLabel":"Sample"');
  });

  it("validates Writer source, rejects duplicate copy, and never silently selects a value", () => {
    const registry = reviewFixture();
    const fields = copy(registry);
    const duplicate = buildPublisherBoard({ registry, locale: "en", copy: [...fields, { ...fields[0]!, value: "Other" }] });
    expect(duplicate.ready).toBe(false);
    expect(duplicate.labels.title).toBe("");
    expect(duplicate.needs).toContainEqual({ target: "writer", ref: "board.title", detail: expect.any(String) });
    const invalid = buildPublisherBoard({ registry, locale: "en", copy: fields.map(field => field.key === "board.title"
      ? { ...field, source: "designer" as "writer" } : field) });
    expect(invalid.ready).toBe(false);
    expect(invalid.labels.title).toBe("");
  });

  it("requires only actual status labels and keeps no-evidence stages Waiting", () => {
    const registry = reviewFixture();
    const fields = copy(registry).filter(field => !["statuses.Failing", "statuses.Needs input", "statuses.Not applicable", "board.no-candidate"].includes(field.key));
    const model = buildPublisherBoard({ registry, locale: "en", copy: fields });
    expect(model.ready).toBe(true);
    expect(rows(model)[0]!.report!.stages.define.status).toBe("Done");
    expect(rows(model)[0]!.report!.stages.publish.status).toBe("Waiting");
    expect(rows(model)[0]!.cells.assemble).toEqual({ status: "Waiting", label: "Writer statuses.Waiting" });
    const absentStatus = buildPublisherBoard({ registry, locale: "en", copy: fields.filter(field => field.key !== "statuses.Waiting") });
    expect(absentStatus.ready).toBe(false);
    expect(absentStatus.needs).toContainEqual({ target: "writer", ref: "statuses.Waiting", detail: expect.any(String) });
    expect(rows(absentStatus)[0]!.cells.assemble.label).toBe("");
  });

  it("binds exact candidate evidence and preserves named stage-engine failures", () => {
    const registry = reviewFixture();
    const proof = stageEvidence(registry.candidates[0]!);
    const valid = buildPublisherBoard({ registry, locale: "en", copy: copy(registry), evidence: [proof] });
    expect(rows(valid)[0]!.cells.publish.status).toBe("Done");
    const stale = buildPublisherBoard({ registry, locale: "en", copy: copy(registry), evidence: [{ ...proof, digest: "stale" }] });
    expect(rows(stale)[0]!.cells.assemble.status).toBe("Failing");
    expect(rows(stale)[0]!.report!.stages.assemble.findings).toContainEqual({ path: "evidence.digest", rule: "evidence-digest", message: expect.any(String) });
    expect(stale.needs).toEqual([]);
    expect(stale.ready).toBe(true);
    const failed = buildPublisherBoard({ registry, locale: "en", copy: copy(registry), evidence: [{ ...proof, review: {
      status: "Failing", findings: [{ path: "content.links", rule: "broken-route", message: "Fix the named route" }],
    } }] });
    expect(rows(failed)[0]!.report!.stages.review.findings[0]!.rule).toBe("broken-route");
  });

  it("joins each supplied proof by candidate id regardless of evidence array order", () => {
    const source = reviewFixture();
    const first = source.candidates[0]!;
    const second = { ...first, id: "alpha", state: "draft" as const };
    const registry = { ...source, candidates: [first, second] };
    const model = buildPublisherBoard({ registry, locale: "en", copy: copy(registry), evidence: [
      { ...stageEvidence(second), words: { status: "Failing", findings: [{ path: "copy.heading", rule: "missing-heading", message: "Complete the heading" }] } },
      stageEvidence(first),
    ] });
    expect(model.ready).toBe(true);
    expect(rows(model).map(row => [row.candidateId, row.cells.assemble.status])).toEqual([["alpha", "Failing"], ["sample", "Done"]]);
    expect(rows(model)[0]!.report!.stages.assemble.findings[0]!.rule).toBe("missing-heading");
  });

  it("reports ambiguous and unmatched evidence without choosing or reassigning proof", () => {
    const registry = reviewFixture();
    const proof = stageEvidence(registry.candidates[0]!);
    const duplicate = buildPublisherBoard({ registry, locale: "en", copy: copy(registry), evidence: [proof, { ...proof, digest: "stale" }] });
    expect(duplicate.ready).toBe(false);
    expect(duplicate.needs).toContainEqual({ target: "publisher", ref: "evidence.sample", detail: expect.any(String) });
    expect(rows(duplicate)[0]!.cells.publish.status).toBe("Waiting");
    const unmatched = buildPublisherBoard({ registry, locale: "en", copy: copy(registry), evidence: [{ ...proof, candidateId: "other" }] });
    expect(unmatched.ready).toBe(false);
    expect(unmatched.needs).toContainEqual({ target: "publisher", ref: "evidence.other", detail: expect.any(String) });
    expect(rows(unmatched)[0]!.cells.publish.status).toBe("Waiting");
  });

  it("retains unknown placement as a named Publisher Need instead of dropping its row", () => {
    const registry = reviewFixture();
    const moved = { ...registry, slots: registry.slots.map(slot => ({ ...slot, l1: "unknown", l2: "unplaced" })) };
    const model = buildPublisherBoard({ registry: moved, locale: "en", copy: copy(moved) });
    expect(model.ready).toBe(false);
    expect(model.needs).toContainEqual({ target: "publisher", ref: `slot.${registry.slots[0]!.id}.placement`, detail: expect.any(String) });
    expect(rows(model).map(row => row.slotId)).toEqual([registry.slots[0]!.id]);
  });

  it("renders an empty valid registry without requiring invisible tree or candidate copy", () => {
    const registry = { ...reviewFixture(), slots: [], candidates: [] };
    const fields = copy(registry).filter(field => !field.key.startsWith("tree.") && !field.key.startsWith("statuses.") && field.key !== "board.no-candidate");
    const model = buildPublisherBoard({ registry, locale: "en", copy: fields });
    expect(model.ready).toBe(true);
    expect(model.lanes).toEqual([]);
  });
});
