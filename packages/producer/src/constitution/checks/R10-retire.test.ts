import { describe, expect, it } from "vitest";
import { AT, cleanSpec, contextOf, expectCatches, sha, type FixtureExtras, type WorkspaceSpec } from "../__fixtures__/workspace.js";
import { candidateRetires, isRecord, neverAgain, slotRetires } from "./R10-retire.js";

const OLD = "{\"name\":\"button\",\"files\":[]}\n";
const record = (extra: Record<string, unknown> = {}) => ({ schema: "clossys.retire/1", slot: "ui.button", candidate: "button-v2.json", sha256: sha(OLD), by: "planner", reason: "superseded: v1 replaces it", at: AT, ...extra });
const slotRecord = (extra: Record<string, unknown> = {}) => ({ schema: "clossys.retire/1", slot: "ui.legacy", by: "planner", reason: "not-needed", at: AT, ...extra });

/** The clean workspace plus a well-formed candidate retire and a well-formed slot retire. */
function retiredSpec(): WorkspaceSpec {
  const spec = cleanSpec();
  spec.designer!["ui.button"]!.retired = { "button-v2.json": OLD, "button-v2.json.json": record() };
  spec.designer!["ui.legacy"] = { live: false, slot: false, pin: false, files: { "ledger.json": { events: [{ op: "retire-slot", code: "not-needed" }] } } };
  return spec;
}
const extras = (): FixtureExtras => ({ agentRetired: { designer: { "ui.old.json": slotRecord({ slot: "ui.old" }) } } });
const clean = () => contextOf(retiredSpec(), extras());
const broken = (edit: (spec: WorkspaceSpec, more: FixtureExtras) => void) => { const spec = retiredSpec(); const more = extras(); edit(spec, more); return contextOf(spec, more); };

describe("R10 retire", () => {
  it("accepts well-formed retired/ records, retired files and tombstones", () => {
    const ctx = clean();
    for (const check of [candidateRetires, slotRetires, neverAgain]) expect(check(ctx)).toEqual([]);
  });

  it("tells records from retired candidate bytes", () => {
    expect(isRecord({ name: "button-v2.json.json" })).toBe(true);
    expect(isRecord({ name: "hero-v2.md.json" })).toBe(true);
    expect(isRecord({ name: "ui.old.json" })).toBe(true);
    expect(isRecord({ name: "button-v2.json" })).toBe(false);
    expect(isRecord({ name: "hero-v2.md" })).toBe(false);
  });

  it("R10.1 flags a free-text reason, mismatched bytes, an unrecorded retired file and a bad ledger event", () => {
    const rows = expectCatches(candidateRetires, clean(), broken(spec => {
      const slot = spec.designer!["ui.button"]!;
      slot.retired = { "button-v2.json": OLD, "button-v2.json.json": record({ reason: "replaced by a newer one", sha256: sha("other") }), "button-v20.json": "x" };
      spec.writer!["home.hero"]!.ledger = { events: [{ op: "retire-candidate", name: "hero-v0.md", sha256: "nope", code: "because" }] };
    }));
    const reasons = rows.map(row => `${row.slot}: ${row.reason}`).join("\n");
    expect(reasons).toMatch(/ui.button: retire record invalid: .*reason.*retired file bytes do not match the record sha256/);
    expect(reasons).toMatch(/ui.button: retired\/button-v20.json has no retire record/);
    expect(reasons).toMatch(/home.hero: retire-candidate event invalid: sha256 is not 64 hex, code because is not one of/);
  });

  it("R10.2 flags an invalid agent-level slot record and a tombstone that holds more than its ledger", () => {
    const rows = expectCatches(slotRetires, clean(), broken((spec, more) => {
      more.agentRetired!.designer!["ui.gone.json"] = slotRecord({ slot: "ui.other", reason: "nobody used it" });
      spec.designer!["ui.legacy"]!.files = { "ledger.json": { events: [{ op: "retire-slot", code: "not-needed" }] }, "notes.txt": "x" };
    }));
    const reasons = rows.map(row => `${row.slot}: ${row.reason}`).join("\n");
    expect(reasons).toMatch(/ui.other: slot retire record invalid: .*reason.*record file is not named ui.other.json/);
    expect(reasons).toMatch(/ui.legacy: tombstone invalid: a tombstone holds only ledger.json, found notes.txt/);
  });

  it("R10.3 flags a retired slot placed again and a retired candidate name written again", () => {
    const rows = expectCatches(neverAgain, clean(), broken((spec, more) => {
      more.agentRetired!.designer!["ui.card.json"] = slotRecord({ slot: "ui.card" });
      spec.designer!["ui.button"]!.candidates!["button-v2.json"] = OLD;
    }));
    expect(rows.map(row => `${row.slot}: ${row.reason}`).sort()).toEqual([
      "ui.button: retired candidate name is written again",
      "ui.card: retired slot id is placed in ia.json again",
    ]);
  });
});
