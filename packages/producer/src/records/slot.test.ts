import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./hash.js";
import {
  SlotFormatError, computedDiff, parseSlot, parseTightenPath, readBaseSlot, resolveBrief, serializeSlot, syncedSlot,
  tightenIssue, validateSlot, writeSlot,
} from "./slot.js";
import type { Slot, Tighten } from "./types.js";
import { AT, CONSUMER, LATER, TALLYHOUSE, packageBaseOf, tallyhouseWorld } from "./__fixtures__/slot2-workspace.js";

// Tallyhouse writer/sections.hero.copy: header.heading maxLength en 60 / fr 72, header.eyebrow en 48,
// claimsFrom ["director/advantage.proposition.proof:Metrics"], one tighten entry (brief.mustDo add).
const HERO = "sections.hero.copy";
const HEADING = "contract.copy.fields[header.heading].maxLength.en";
const METRICS = "director/advantage.proposition.proof:Metrics";
const PROMISE = "director/advantage.proposition.promise:Promise";
const tallyhouse = (agent: string, id: string): Slot => JSON.parse(readFileSync(join(TALLYHOUSE, "clossys/agents", agent, id, "slot.json"), "utf8")) as Slot;
const consumed = tallyhouse("writer", HERO);
const fixtureEntry = consumed.tighten[0]!;
const entry = (path: string, op: Tighten["op"], value: unknown): Tighten => ({ ...fixtureEntry, path, op, value });

describe("clossys.slot/2 reader and writer", () => {
  it("accepts every Tallyhouse slot/2 file and writes canonical bytes once", () => {
    expect(validateSlot(consumed)).toEqual([]);
    expect(validateSlot(tallyhouse("director", "identity.naming.name"))).toEqual([]);
    const ws = tallyhouseWorld();
    const file = ws.file("writer", HERO);
    expect(writeSlot(file, consumed)).toBe(true);
    const bytes = readFileSync(file, "utf8");
    expect(serializeSlot(parseSlot(bytes, file))).toBe(bytes);
    expect(writeSlot(file, parseSlot(bytes, file))).toBe(false);
    expect(Object.keys(JSON.parse(bytes)).slice(0, 6)).toEqual(["schema", "id", "agent", "kind", "status", "ia"]);
  });

  it("refuses slot/1, unknown keys, an empty purpose and an unknown status", () => {
    expect(() => parseSlot(readFileSync(join(CONSUMER, "clossys/agents/writer/lexicon.sentence-length/slot.json"), "utf8"))).toThrow(SlotFormatError);
    expect(() => parseSlot(JSON.stringify({ ...consumed, inputs: [] }))).toThrow(SlotFormatError);
    expect(() => parseSlot(JSON.stringify({ ...consumed, brief: { ...consumed.brief, purpose: "" } }))).toThrow(SlotFormatError);
    expect(() => writeSlot(tallyhouseWorld().file("writer", HERO), { ...consumed, status: "pinned" as never })).toThrow(SlotFormatError);
  });

  it("parses tighten paths rooted at brief or contract", () => {
    expect(parseTightenPath(HEADING)).toEqual([{ key: "contract" }, { key: "copy" }, { key: "fields" }, { select: "header.heading" }, { key: "maxLength" }, { key: "en" }]);
    expect(parseTightenPath("brief.mustDo")).toEqual([{ key: "brief" }, { key: "mustDo" }]);
    expect(parseTightenPath("refs.0")).toMatch(/must start at brief or contract/);
    expect(parseTightenPath("contract.copy.fields[header.heading")).toMatch(/unclosed/);
  });
});

describe("tighten: stricter only", () => {
  const scope = packageBaseOf(consumed);

  it("max and min against a budget", () => {
    expect(tightenIssue(scope, entry(HEADING, "max", 48))).toBeNull();
    expect(tightenIssue(scope, entry(HEADING, "max", 60))).toBeNull();
    expect(tightenIssue(scope, entry(HEADING, "max", 72))).toMatch(/max 72 is looser than the base 60/);
    expect(tightenIssue(scope, entry(HEADING, "min", 72))).toBeNull();
    expect(tightenIssue(scope, entry(HEADING, "min", 48))).toMatch(/min 48 is looser than the base 60/);
    expect(tightenIssue(scope, entry(HEADING, "max", "48"))).toMatch(/takes a number/);
    expect(tightenIssue(scope, entry("contract.claimsFrom", "max", 1))).toMatch(/applies to a number field/);
  });

  it("add only on requirement lists, remove and narrow only on allowed sets", () => {
    expect(tightenIssue(scope, fixtureEntry)).toBeNull();
    expect(tightenIssue(scope, entry("contract.locales.required", "add", "fr"))).toBeNull();
    expect(tightenIssue(scope, entry("contract.claimsFrom", "add", PROMISE))).toMatch(/add widens an allowed list/);
    expect(tightenIssue(scope, entry("brief.mustDo", "remove", consumed.brief.mustDo[0]))).toMatch(/drops a requirement/);
    expect(tightenIssue(scope, entry("contract.claimsFrom", "remove", METRICS))).toBeNull();
    expect(tightenIssue(scope, entry("contract.claimsFrom", "remove", PROMISE))).toMatch(/does not allow/);
    expect(tightenIssue(scope, entry("contract.claimsFrom", "narrow", [METRICS]))).toBeNull();
    expect(tightenIssue(scope, entry("contract.claimsFrom", "narrow", [METRICS, PROMISE]))).toMatch(/narrow adds/);
    expect(tightenIssue(scope, entry("contract.claimsFrom", "narrow", []))).toMatch(/non-empty/);
  });

  it("require takes true; a path missing from the base is refused", () => {
    expect(tightenIssue(scope, entry("contract.copy.fields[header.eyebrow].required", "require", true))).toBeNull();
    expect(tightenIssue(scope, entry("contract.copy.fields[header.eyebrow].required", "require", false))).toMatch(/require takes true/);
    expect(tightenIssue(scope, entry("contract.copy.fields[header.heading].minLength.en", "min", 1))).toMatch(/no such field/);
  });

  it("resolveBrief applies valid entries in order and reports looser ones", () => {
    const slot = { ...consumed, tighten: [fixtureEntry, entry(HEADING, "max", 48), entry(HEADING, "max", 72), entry("contract.claimsFrom", "narrow", [METRICS])] };
    const resolved = resolveBrief(slot, scope);
    expect((resolved.contract.copy as { fields: { key: string; maxLength: { en: number } }[] }).fields.find(field => field.key === "header.heading")!.maxLength.en).toBe(48);
    expect(resolved.brief.mustDo).toEqual([...consumed.brief.mustDo, fixtureEntry.value]);
    expect(resolved.issues).toEqual([expect.stringMatching(/max 72 is looser/)]);
    expect(scope.brief.mustDo).toEqual(consumed.brief.mustDo);
  });
});

describe("package base and sync", () => {
  it("reads the installed base with its sha and version; a wrong id throws", () => {
    const ws = tallyhouseWorld();
    const base = readBaseSlot(ws.root, "writer", HERO)!;
    expect(base.meta).toEqual({ package: "@clossys/writer", version: "1.0.0", path: `src/catalog/slots/${HERO}/slot.json`, sha256: sha256Hex(readFileSync(ws.baseFile("writer", HERO), "utf8")) });
    expect(base.meta.sha256).not.toBe(consumed.base!.sha256);
    expect(readBaseSlot(ws.root, "writer", "narratives.legal-document")).toBeUndefined();
    writeFileSync(ws.baseFile("writer", HERO), readFileSync(ws.baseFile("writer", "lexicon.sentence-length")));
    expect(() => readBaseSlot(ws.root, "writer", HERO)).toThrow(/expected writer\/sections.hero.copy/);
  });

  it("syncedSlot keeps tighten, status, createdAt, consumedBy and same-L2 order; computedDiff names hand edits", () => {
    const ws = tallyhouseWorld();
    const base = readBaseSlot(ws.root, "writer", HERO)!;
    const synced = syncedSlot(base, consumed, LATER);
    expect(synced).toMatchObject({ status: "live", createdAt: consumed.createdAt, updatedAt: LATER, tighten: consumed.tighten, base: base.meta });
    expect(synced.refs).toEqual(consumed.refs);
    expect(serializeSlot(syncedSlot(base, synced, AT))).toBe(serializeSlot(synced));
    expect(computedDiff(synced, base)).toEqual([]);
    const other = tallyhouse("director", "identity.naming.name");
    expect(computedDiff({ ...synced, brief: { ...synced.brief, purpose: other.brief.purpose } }, base)).toEqual(["brief"]);
    expect(computedDiff({ ...synced, standard: other.standard, refs: [] }, base)).toEqual(["standard", "refs"]);
  });
});
