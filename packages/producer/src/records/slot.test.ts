import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./hash.js";
import {
  SlotFormatError, computedDiff, parseSlot, parseTightenPath, readBaseSlot, resolveBrief, serializeSlot, syncedSlot,
  tightenIssue, validateSlot, writeSlot,
} from "./slot.js";
import type { Tighten } from "./types.js";
import { AT, LATER, VERSION, baseSlot, slot2Workspace } from "./__fixtures__/slot2-workspace.js";

const by = { actor: "owner" as const, ref: "fb-1" };
const entry = (path: string, op: Tighten["op"], value: unknown): Tighten => ({ path, op, value, why: "test", by, at: AT });
const HEADING = "contract.copy.fields[heading].maxLength.en";

describe("clossys.slot/2 reader and writer", () => {
  it("round-trips canonical bytes and writes nothing the second time", () => {
    const ws = slot2Workspace();
    const slot = baseSlot("writer", "sections.hero.copy");
    expect(validateSlot(slot)).toEqual([]);
    const file = ws.file("writer", "sections.hero.copy");
    expect(writeSlot(file, slot)).toBe(true);
    const bytes = readFileSync(file, "utf8");
    expect(bytes.endsWith("}\n")).toBe(true);
    expect(serializeSlot(parseSlot(bytes, file))).toBe(bytes);
    expect(writeSlot(file, parseSlot(bytes, file))).toBe(false);
    expect(Object.keys(JSON.parse(bytes)).slice(0, 6)).toEqual(["schema", "id", "agent", "kind", "status", "ia"]);
  });

  it("refuses slot/1, unknown keys and an empty purpose", () => {
    const slot = baseSlot("writer", "sections.hero.copy");
    expect(() => parseSlot(JSON.stringify({ ...slot, schema: "clossys.slot/1" }))).toThrow(SlotFormatError);
    expect(() => parseSlot(JSON.stringify({ ...slot, inputs: [] }))).toThrow(SlotFormatError);
    expect(() => parseSlot(JSON.stringify({ ...slot, brief: { ...slot.brief, purpose: "" } }))).toThrow(SlotFormatError);
    expect(() => writeSlot(slot2Workspace().file("writer", "x.y"), { ...slot, status: "done" as never })).toThrow(SlotFormatError);
  });

  it("parses tighten paths rooted at brief or contract", () => {
    expect(parseTightenPath(HEADING)).toEqual([{ key: "contract" }, { key: "copy" }, { key: "fields" }, { select: "heading" }, { key: "maxLength" }, { key: "en" }]);
    expect(parseTightenPath("brief.mustDo")).toEqual([{ key: "brief" }, { key: "mustDo" }]);
    expect(parseTightenPath("refs.0")).toMatch(/must start at brief or contract/);
    expect(parseTightenPath("contract.copy.fields[heading")).toMatch(/unclosed/);
  });
});

describe("tighten: stricter only", () => {
  const scope = baseSlot("writer", "sections.hero.copy");

  it("max and min: lower max and higher min pass, the reverse is looser", () => {
    expect(tightenIssue(scope, entry(HEADING, "max", 40))).toBeNull();
    expect(tightenIssue(scope, entry(HEADING, "max", 60))).toBeNull();
    expect(tightenIssue(scope, entry(HEADING, "max", 80))).toMatch(/max 80 is looser than the base 60/);
    expect(tightenIssue(scope, entry("contract.copy.fields[heading].minLength.en", "min", 10))).toBeNull();
    expect(tightenIssue(scope, entry(HEADING, "min", 10))).toMatch(/min 10 is looser than the base 60/);
    expect(tightenIssue(scope, entry(HEADING, "max", "40"))).toMatch(/takes a number/);
    expect(tightenIssue(scope, entry("contract.tones", "max", 2))).toMatch(/applies to a number field/);
  });

  it("add only on requirement lists, remove and narrow only on allowed sets", () => {
    expect(tightenIssue(scope, entry("brief.mustDo", "add", "Name the price"))).toBeNull();
    expect(tightenIssue(scope, entry("contract.required", "add", "body"))).toBeNull();
    expect(tightenIssue(scope, entry("contract.tones", "add", "loud"))).toMatch(/add widens an allowed list/);
    expect(tightenIssue(scope, entry("brief.mustDo", "remove", "Lead with the outcome"))).toMatch(/drops a requirement/);
    expect(tightenIssue(scope, entry("contract.tones", "remove", "bold"))).toBeNull();
    expect(tightenIssue(scope, entry("contract.tones", "remove", "loud"))).toMatch(/does not allow/);
    expect(tightenIssue(scope, entry("contract.tones", "narrow", ["plain"]))).toBeNull();
    expect(tightenIssue(scope, entry("contract.tones", "narrow", ["plain", "loud"]))).toMatch(/narrow adds/);
    expect(tightenIssue(scope, entry("contract.tones", "narrow", []))).toMatch(/non-empty/);
  });

  it("require takes true; a path missing from the base is refused", () => {
    expect(tightenIssue(scope, entry("contract.copy.fields[heading].sentenceCase", "require", true))).toBeNull();
    expect(tightenIssue(scope, entry("contract.copy.fields[heading].sentenceCase", "require", false))).toMatch(/require takes true/);
    expect(tightenIssue(scope, entry("contract.nothing.here", "max", 1))).toMatch(/no such field/);
  });

  it("resolveBrief applies valid entries in order and reports looser ones", () => {
    const slot = { ...scope, tighten: [entry(HEADING, "max", 40), entry(HEADING, "max", 80), entry("brief.mustDo", "add", "Name the price"), entry("contract.tones", "narrow", ["plain", "warm"])] };
    const resolved = resolveBrief(slot, scope);
    expect((resolved.contract.copy as { fields: { maxLength: { en: number } }[] }).fields[0]!.maxLength.en).toBe(40);
    expect(resolved.brief.mustDo).toEqual(["Lead with the outcome", "Name the price"]);
    expect(resolved.contract.tones).toEqual(["plain", "warm"]);
    expect(resolved.issues).toEqual([expect.stringMatching(/max 80 is looser/)]);
    expect(scope.brief.mustDo).toEqual(["Lead with the outcome"]);
  });
});

describe("package base and sync", () => {
  it("reads the installed base with its sha and version; a wrong id throws", () => {
    const ws = slot2Workspace();
    const file = ws.base(baseSlot("writer", "sections.hero.copy"), "1.2.0");
    const base = readBaseSlot(ws.root, "writer", "sections.hero.copy")!;
    expect(base.meta).toEqual({ package: "@clossys/writer", version: "1.2.0", path: "src/catalog/slots/sections.hero.copy/slot.json", sha256: sha256Hex(readFileSync(file, "utf8")) });
    expect(readBaseSlot(ws.root, "writer", "sections.other.copy")).toBeUndefined();
    writeFileSync(file, serializeSlot(baseSlot("writer", "sections.wrong.copy")));
    expect(() => readBaseSlot(ws.root, "writer", "sections.hero.copy")).toThrow(/expected writer\/sections.hero.copy/);
  });

  it("syncedSlot keeps tighten, status, createdAt, consumedBy and same-L2 order; computedDiff names hand edits", () => {
    const ws = slot2Workspace();
    ws.base(baseSlot("writer", "sections.hero.copy", { refs: [{ to: "director/identity.naming.name", rel: "input" }] }));
    const base = readBaseSlot(ws.root, "writer", "sections.hero.copy")!;
    const first = syncedSlot(base, undefined, AT);
    expect(first.base).toEqual(base.meta);
    expect(first.createdBy).toEqual({ actor: "package", package: "@clossys/writer", version: VERSION });
    const consumer = { ...first, status: "live" as const, ia: { ...first.ia, order: 7 }, tighten: [entry(HEADING, "max", 40)], refs: [...first.refs, { to: "publisher/page.home" as const, rel: "consumedBy" as const }] };
    const again = syncedSlot(base, consumer, LATER);
    expect(serializeSlot(again)).toBe(serializeSlot(consumer));
    expect(computedDiff(consumer, base)).toEqual([]);
    expect(computedDiff({ ...consumer, brief: { ...consumer.brief, purpose: "Hand edited." } }, base)).toEqual(["brief"]);
    expect(computedDiff({ ...consumer, standard: "copy.long", refs: [] }, base)).toEqual(["standard", "refs"]);
  });
});
