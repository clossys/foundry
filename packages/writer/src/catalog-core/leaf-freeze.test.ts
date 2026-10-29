import { describe, expect, it } from "vitest";
import {
  assertWriterLeafSets, checkWriterLeafSets, loadWriterLeafFreezeSnapshots,
  type WriterLeafAmendment, type WriterLeafFreezeSnapshot, type WriterLeafPlacement,
} from "./leaf-freeze.js";

const signedHead = "a".repeat(40);
const candidate = (): WriterLeafFreezeSnapshot => ({
  schemaVersion: 1, layer: "lexicon", scope: "leaf-membership-only", signedHead: null,
  ownerSignoffComment: null, policy: "Proposed membership; owner signoff is pending.",
  leafIds: ["lexicon.term", "lexicon.naming"],
});
const inputs = () => ({
  placements: [{ layer: "lexicon", nodes: [{ id: "domain", label: "Domain", children: [
    { id: "family", label: "Family", leaves: ["lexicon.term", "lexicon.naming"] },
  ] }] }] satisfies WriterLeafPlacement[],
  slots: [{ id: "lexicon.term", layer: "lexicon" }, { id: "lexicon.naming", layer: "lexicon" }],
});
const signed = (): WriterLeafFreezeSnapshot => ({ ...candidate(), signedHead, ownerSignoffComment: "Owner approval fixture" });
const amendment = (): WriterLeafAmendment => ({
  schemaVersion: 1, layer: "lexicon", baseSignedHead: signedHead, status: "owner-signed",
  ownerSignoffComment: "Owner amendment fixture", addedLeafIds: ["lexicon.inflection"],
});

describe("independent Writer candidate membership", () => {
  it("compares proposed membership without inventing owner approval", () => {
    const value = inputs();
    const snapshot = candidate();
    expect(checkWriterLeafSets(value.placements, value.slots, ["lexicon"], { snapshots: [snapshot] })).toEqual([]);
    expect(snapshot.signedHead).toBeNull();
    expect(snapshot.ownerSignoffComment).toBeNull();
  });
  for (const source of ["slots", "ia", "both"] as const) for (const mutation of ["add", "remove", "rename"] as const) {
    it(`rejects ${source} ${mutation}, including coordinated same-count renames`, () => {
      const value = inputs();
      if (source !== "ia") {
        if (mutation === "add") value.slots.push({ id: "lexicon.new-term", layer: "lexicon" });
        else if (mutation === "remove") value.slots.shift();
        else value.slots[0]!.id = "lexicon.new-term";
      }
      if (source !== "slots") {
        const leaves = value.placements[0]!.nodes[0]!.children[0]!.leaves;
        if (mutation === "add") leaves.push("lexicon.new-term");
        else if (mutation === "remove") leaves.shift();
        else leaves[0] = "lexicon.new-term";
      }
      const options = { snapshots: [candidate()] };
      const findings = checkWriterLeafSets(value.placements, value.slots, ["lexicon"], options);
      expect(findings.map(finding => finding.source)).toEqual(source === "both" ? ["slots", "ia"] : [source]);
      for (const finding of findings) {
        expect(finding).toMatchObject({ code: "LEAF_FREEZE", severity: "error", layer: "lexicon" });
        expect(finding.missing).toEqual(mutation === "add" ? [] : ["lexicon.term"]);
        expect(finding.unexpected).toEqual(mutation === "remove" ? [] : ["lexicon.new-term"]);
        expect(finding.message).toContain("candidate");
      }
      expect(() => assertWriterLeafSets(value.placements, value.slots, ["lexicon"], options)).toThrow("LEAF_FREEZE");
    });
  }
  it("finds an entirely omitted offered layer independently in both sources", () => {
    expect(checkWriterLeafSets([], [], ["lexicon"], { snapshots: [candidate()] })).toEqual([
      expect.objectContaining({ source: "slots", missing: ["lexicon.naming", "lexicon.term"], unexpected: [] }),
      expect.objectContaining({ source: "ia", missing: ["lexicon.naming", "lexicon.term"], unexpected: [] }),
    ]);
  });
  it("permits labels, regrouping, order and unrelated slot metadata", () => {
    const value = inputs();
    const placement: WriterLeafPlacement = { layer: "lexicon", nodes: [
      { id: "different", label: "Different", children: [{ id: "nested", label: "Nested", children: [
        { id: "renamed", label: "Renamed", leaves: ["lexicon.naming", "lexicon.term"] },
      ] }] },
    ] };
    value.slots.reverse();
    Object.assign(value.slots[0]!, { description: "Independent metadata" });
    expect(checkWriterLeafSets([placement], value.slots, ["lexicon"], { snapshots: [candidate()] })).toEqual([]);
  });
  it("keeps passages and narratives unfrozen, even with no placement or slots", () => {
    expect(checkWriterLeafSets([], [], ["passages", "narratives"], { snapshots: [] })).toEqual([]);
  });
  it("loads only three owner-signed baseline files, independently of slots and IA", () => {
    const snapshots = loadWriterLeafFreezeSnapshots();
    expect(snapshots.map(snapshot => snapshot.layer)).toEqual(["lexicon", "strings", "patterns"]);
    for (const snapshot of snapshots) expect(snapshot).toMatchObject({
      schemaVersion: 1, scope: "leaf-membership-only", signedHead: "0b06a262bc9447787b9e79393125f1369bfb3470", ownerSignoffComment: "owner sign-off 2026-10-28",
    });
  });
});

describe("Writer baseline validation", () => {
  const invalid: [string, (snapshot: Record<string, unknown>) => void][] = [
    ["wrong schema", snapshot => { snapshot.schemaVersion = 2; }],
    ["unfrozen layer", snapshot => { snapshot.layer = "passages"; snapshot.leafIds = ["passages.hero"]; }],
    ["wrong scope", snapshot => { snapshot.scope = "all-metadata"; }],
    ["missing policy", snapshot => { delete snapshot.policy; }],
    ["blank policy", snapshot => { snapshot.policy = " "; }],
    ["duplicate leaf", snapshot => { snapshot.leafIds = ["lexicon.term", "lexicon.term"]; }],
    ["wrong leaf prefix", snapshot => { snapshot.leafIds = ["strings.term"]; }],
    ["invalid leaf", snapshot => { snapshot.leafIds = ["lexicon.term.extra"]; }],
    ["missing leaves", snapshot => { delete snapshot.leafIds; }],
    ["invalid signed head", snapshot => { snapshot.signedHead = "a".repeat(39); snapshot.ownerSignoffComment = "Approval"; }],
    ["nonhex signed head", snapshot => { snapshot.signedHead = "g".repeat(40); snapshot.ownerSignoffComment = "Approval"; }],
    ["signed head with a terminal newline", snapshot => { snapshot.signedHead = `${signedHead}\n`; snapshot.ownerSignoffComment = "Approval"; }],
    ["head without owner comment", snapshot => { snapshot.signedHead = signedHead; }],
    ["comment without head", snapshot => { snapshot.ownerSignoffComment = "Approval"; }],
    ["blank owner comment", snapshot => { snapshot.signedHead = signedHead; snapshot.ownerSignoffComment = " "; }],
  ];
  for (const [label, mutate] of invalid) it(`refuses ${label}`, () => {
    const snapshot = candidate() as unknown as Record<string, unknown>;
    mutate(snapshot);
    expect(() => checkWriterLeafSets([], [], ["lexicon"], { snapshots: [snapshot] })).toThrow("LEAF_FREEZE");
  });
  it("refuses duplicate snapshots and missing offered baselines", () => {
    expect(() => checkWriterLeafSets([], [], ["lexicon"], { snapshots: [candidate(), candidate()] })).toThrow("LEAF_FREEZE");
    expect(() => checkWriterLeafSets([], [], ["lexicon"], { snapshots: [] })).toThrow("LEAF_FREEZE");
  });
});

describe("explicit owner-signed Writer additions", () => {
  it("accepts only explicit signed additions against the signed baseline", () => {
    const value = inputs();
    value.slots.push({ id: "lexicon.inflection", layer: "lexicon" });
    value.placements[0]!.nodes[0]!.children[0]!.leaves.push("lexicon.inflection");
    const snapshot = signed();
    expect(checkWriterLeafSets(value.placements, value.slots, ["lexicon"], { snapshots: [snapshot], amendments: [amendment()] })).toEqual([]);
    expect(snapshot.leafIds).toEqual(candidate().leafIds);
    value.slots.pop();
    expect(checkWriterLeafSets(value.placements, value.slots, ["lexicon"], { snapshots: [snapshot], amendments: [amendment()] })).toEqual([
      expect.objectContaining({ source: "slots", missing: ["lexicon.inflection"], unexpected: [] }),
    ]);
  });
  const invalid: [string, (value: Record<string, unknown>) => void][] = [
    ["wrong schema", value => { value.schemaVersion = 2; }],
    ["wrong base", value => { value.baseSignedHead = "b".repeat(40); }],
    ["unsigned status", value => { value.status = "pending-owner-ratification"; }],
    ["missing owner comment", value => { delete value.ownerSignoffComment; }],
    ["blank owner comment", value => { value.ownerSignoffComment = " "; }],
    ["wrong prefix", value => { value.addedLeafIds = ["strings.inflection"]; }],
    ["malformed leaf", value => { value.addedLeafIds = ["lexicon.inflection.extra"]; }],
    ["duplicate addition", value => { value.addedLeafIds = ["lexicon.inflection", "lexicon.inflection"]; }],
    ["existing baseline leaf", value => { value.addedLeafIds = ["lexicon.term"]; }],
    ["empty additions", value => { value.addedLeafIds = []; }],
    ["missing additions", value => { delete value.addedLeafIds; }],
  ];
  for (const [label, mutate] of invalid) it(`refuses amendment ${label}`, () => {
    const value = amendment() as unknown as Record<string, unknown>;
    mutate(value);
    expect(() => checkWriterLeafSets([], [], ["lexicon"], { snapshots: [signed()], amendments: [value] })).toThrow("LEAF_FREEZE");
  });
  it("refuses amendments to an unsigned candidate and repeated additions across amendments", () => {
    expect(() => checkWriterLeafSets([], [], ["lexicon"], { snapshots: [candidate()], amendments: [amendment()] })).toThrow("LEAF_FREEZE");
    expect(() => checkWriterLeafSets([], [], ["lexicon"], { snapshots: [signed()], amendments: [amendment(), amendment()] })).toThrow("LEAF_FREEZE");
  });
});
