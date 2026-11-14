import { describe, expect, it } from "vitest";
import { cleanSpec, contextOf, expectCatches, slotDoc, type WorkspaceSpec } from "../__fixtures__/workspace.js";
import { cardinality } from "./R04-cardinality.js";

const clean = () => contextOf(cleanSpec());
const broken = (edit: (spec: WorkspaceSpec) => void) => { const spec = cleanSpec(); edit(spec); return contextOf(spec); };

describe("R04 cardinality", () => {
  it("passes a workspace where every live slot has a candidate and one valid pin", () => {
    expect(cardinality(clean())).toEqual([]);
  });

  it("flags a live slot with no pin.json", () => {
    const rows = expectCatches(cardinality, clean(), broken(spec => { spec.designer!["ui.button"]!.pin = false; }));
    expect(rows).toEqual([expect.objectContaining({ rule: "R04", agent: "designer", slot: "ui.button", reason: "no pin.json" })]);
  });

  it("flags a live slot with no candidate", () => {
    const rows = expectCatches(cardinality, clean(), broken(spec => { spec.writer!["home.cta"] = { slot: slotDoc("writer", "home.cta"), candidates: {}, pin: false }; }));
    expect(rows).toEqual([expect.objectContaining({ slot: "home.cta", reason: "no candidate; no pin.json" })]);
  });

  it("flags a pin naming a missing candidate or the wrong bytes", () => {
    const rows = expectCatches(cardinality, clean(), broken(spec => {
      spec.designer!["ui.button"]!.pin = { candidate: "button-v9.json", sha256: "0".repeat(64), decidedBy: "planner", basis: "planner", at: "2026-11-13T00:00:00Z" };
      spec.director!["brand.voice"]!.pin = { candidate: "voice-v1.md", sha256: "0".repeat(64), decidedBy: "planner", basis: "planner", at: "2026-11-13T00:00:00Z" };
    }));
    expect(rows.map(row => row.reason).sort()).toEqual([
      "pinned candidate button-v9.json does not exist",
      "pinned candidate voice-v1.md sha256 does not match pin.json",
    ]);
  });

  it("flags slot.json notNeeded and an unreadable pin", () => {
    const rows = expectCatches(cardinality, clean(), broken(spec => {
      spec.designer!["ui.card"]!.slot = { ...slotDoc("designer", "ui.card", { uses: ["ui.button"] }), notNeeded: true };
      spec.writer!["home.hero"]!.files = {};
      spec.writer!["home.hero"]!.pin = "{ not json" as unknown as Record<string, unknown>;
    }));
    expect(rows.find(row => row.slot === "ui.card")?.reason).toMatch(/notNeeded/);
    expect(rows.find(row => row.slot === "home.hero")?.reason).toMatch(/pin.json unreadable/);
  });

  it("holds Producer seats to the same rule and ignores slots that are not live", () => {
    const rows = expectCatches(cardinality, clean(), broken(spec => {
      spec.producer!.director!.pin = false;
      spec.designer!["ui.old"] = { live: false, candidates: {}, pin: false };
    }));
    expect(rows).toEqual([expect.objectContaining({ agent: "producer", slot: "director", reason: "no pin.json" })]);
  });
});
