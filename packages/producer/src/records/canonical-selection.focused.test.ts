import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { persistCanonicalSelection, type CanonicalSelectionInput } from "../index.js";
import { libraryRecordStore } from "../specimen/library-source.js";
import { slotInstallInputs } from "../specimen/slot-install-inputs.js";
import { sha256Hex } from "./hash.js";
import { jsonBytes, serializeFrontmatter } from "./slot-model/index.js";
import { readPin } from "./slots.js";

let root: string, dir: string, candidatePath: string, pinPath: string, input: CanonicalSelectionInput;
const slot = "sections.hero", at = "2026-10-31T12:00:00Z", reference = "owner decision reference";
const save = (path: string, value: unknown) => writeFileSync(path, jsonBytes(value));
const load = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const record = () => ({ id: "pin-decision", actor: "owner", owner: "example-owner", reference, at,
  action: "pin", slot, element: "hero", version: 1, hash: input.contentHash });
const approve = (patch: Record<string, unknown> = {}) => save(join(root, "approvals.json"), {
  schema: "clossys.owner-approvals/1", records: [{ ...record(), ...patch }],
});
const priorPin = () => {
  save(pinPath, { candidate: "hero-v1.json", sha256: input.contentHash, pinnedBy: "owner:previous decision", at });
  input = { ...input, expectedPinHash: sha256Hex(readFileSync(pinPath)) };
};
const expectUnchangedRefusal = () => {
  const before = existsSync(pinPath) ? readFileSync(pinPath) : null;
  expect(() => persistCanonicalSelection(input)).toThrow();
  expect(existsSync(pinPath) ? readFileSync(pinPath) : null).toEqual(before);
  expect(readdirSync(dir).filter(name => name.endsWith(".tmp"))).toEqual([]);
};

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "canonical-selection-")));
  dir = join(root, "agents/designer/sections.content/hero", slot);
  mkdirSync(join(dir, "candidates"), { recursive: true });
  candidatePath = join(dir, "candidates/hero-v1.json");
  pinPath = join(dir, "pin.json");
  save(join(root, "agents/designer/ia.json"), { schema: "clossys.ia/1", source: "fixture#freeze", extensions: [],
    nodes: [{ id: "sections.content", label: "Sections", children: [{ id: "hero", label: "Hero", slots: [slot] }] }] });
  save(join(dir, "slot.json"), { schema: "clossys.slot/1", id: slot, agent: "designer", kind: "element",
    ia: { l0: "sections", l1: "sections.content", l2: "hero", order: 0 }, contract: {}, inputs: [], uses: [] });
  save(candidatePath, { name: "hero", type: "registry:block", files: [], meta: { source: { kind: "original", ref: [] } } });
  input = { root, agent: "designer", slot, id: "hero", version: 1, contentHash: sha256Hex(readFileSync(candidatePath)), approval: "pin-decision", expectedPinHash: null };
  approve();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("public canonical selection persistence", () => {
  it.each(["director", "writer", "publisher"] as const)("persists an explicit native %s candidate with its actual approval", agent => {
    const id = agent === "director" ? "brief.example" : agent === "writer" ? "strings.example" : "page.example";
    const kind = agent === "director" ? "brief" : agent === "writer" ? "strings" : "page";
    const placed = join(root, "agents", agent, "content/group", id), ext = agent === "publisher" ? "json" : "md";
    mkdirSync(join(placed, "candidates"), { recursive: true });
    save(join(root, "agents", agent, "ia.json"), { schema: "clossys.ia/1", source: "fixture#freeze", extensions: [],
      nodes: [{ id: "content", label: "Content", children: [{ id: "group", label: "Group", slots: [id] }] }] });
    save(join(placed, "slot.json"), { schema: "clossys.slot/1", id, agent, kind,
      ia: { ...(agent === "writer" ? { l0: "content" } : {}), l1: "content", l2: "group", order: 0 }, contract: {}, inputs: [], uses: [] });
    const source = { kind: "original", ref: [] };
    const bytes = agent === "publisher" ? jsonBytes({ schema: "clossys.page/1", title: "Example", path: "/", frame: null, sections: [], copy: {}, meta: { source } })
      : agent === "director" ? serializeFrontmatter({ slot: id, source, feeds: [], functions: [] }, "## Direction\nExample\n## Because\nEvidence\n## Watch\nConstraint\n")
        : serializeFrontmatter({ slot: id, source, locales: ["en"] }, '## en\n### example.title\n<!-- {"id":"example-title","bindings":[]} -->\nExample\n');
    writeFileSync(join(placed, "candidates", `hero-v1.${ext}`), bytes);
    input = { ...input, agent, slot: id, contentHash: sha256Hex(bytes) }; approve({ slot: id });
    const result = persistCanonicalSelection(input);
    expect(result).toMatchObject({ id: `${id}/hero`, version: 1, contentHash: input.contentHash, selected: true, approved: true });
    expect(readPin(root, agent, id)).toEqual(result.pin);
  });

  it("keeps a candidate Draft until a real decision, then exposes the exact persisted pin to canonical consumers", async () => {
    const store = libraryRecordStore([root]);
    expect(await store.load(`${slot}/hero`)).toBeUndefined();
    expect(await store.load(`${slot}/hero`, 1)).toMatchObject({ id: `${slot}/hero`, version: 1, contentHash: input.contentHash });
    expect(slotInstallInputs(root)?.pins).toEqual({});
    const result = persistCanonicalSelection(input);
    expect(result).toMatchObject({ root, agent: "designer", slot, id: `${slot}/hero`, version: 1, contentHash: input.contentHash,
      selected: true, approved: true, approval: record(), pin: { candidate: "hero-v1.json", sha256: input.contentHash, pinnedBy: `owner:${reference}`, at } });
    expect(result.refs).toEqual({ ia: join(root, "agents/designer/ia.json"), slot: join(dir, "slot.json"), candidate: candidatePath, pin: pinPath, approval: join(root, "approvals.json") });
    expect(readPin(root, "designer", slot)).toEqual(result.pin);
    expect(result.pinHash).toBe(sha256Hex(readFileSync(pinPath)));
    expect(await store.load(`${slot}/hero`)).toMatchObject({ version: 1, contentHash: input.contentHash });
    expect(slotInstallInputs(root)?.pins).toEqual({ [slot]: { element: "hero", version: 1 } });
    expect(existsSync(join(root, "selection.json"))).toBe(false);
    expect(existsSync(`${pinPath}.lock`)).toBe(false);
  });

  it("rejects a missing approval despite caller-supplied owner/actor claims and preserves Draft bytes", () => {
    rmSync(join(root, "approvals.json"));
    const bytes = readFileSync(candidatePath);
    input = { ...input, approval: undefined, actor: "owner", owner: "example-owner" } as unknown as CanonicalSelectionInput;
    expectUnchangedRefusal();
    expect(readFileSync(candidatePath)).toEqual(bytes);
    expect(readPin(root, "designer", slot)).toBeNull();
    expect(readdirSync(root)).toEqual(["agents"]);
  });

  it("leaves an existing selection unchanged when approval is omitted", () => {
    priorPin();
    input = { ...input, approval: undefined } as unknown as CanonicalSelectionInput;
    expectUnchangedRefusal();
  });

  it("refuses invalid UTF-8 approval evidence and preserves the previous pin", () => {
    priorPin(); approve({ reference: "\ufffd" });
    const path = join(root, "approvals.json"), bytes = readFileSync(path), offset = bytes.indexOf(Buffer.from("\ufffd"));
    writeFileSync(path, Buffer.concat([bytes.subarray(0, offset), Buffer.from([0xff]), bytes.subarray(offset + 3)]));
    expect(() => persistCanonicalSelection(input)).toThrow(/approval evidence is not valid UTF-8/);
    expectUnchangedRefusal();
  });

  it.each([
    ["action", "create"], ["slot", "sections.other"], ["element", "other"], ["version", 2], ["hash", "0".repeat(64)],
    ["actor", "designer"], ["owner", "designer"], ["owner", ""], ["reference", ""], ["at", "invalid"], ["at", "2026-10-31"],
  ])("refuses approval with mismatched or invalid %s=%s", (key, value) => {
    priorPin(); approve({ [key]: value }); expectUnchangedRefusal();
  });

  it("refuses duplicate approval ids", () => {
    save(join(root, "approvals.json"), { schema: "clossys.owner-approvals/1", records: [record(), record()] });
    expectUnchangedRefusal();
  });

  it("refuses target hash mismatch even when the approval matches the supplied wrong hash", () => {
    input = { ...input, contentHash: "0".repeat(64) }; approve(); expectUnchangedRefusal();
  });

  it.each(["status", "identity", "slot", "version", "utf8"]) ("refuses invalid candidate %s despite a matching approval and hash", mutation => {
    const item = load(candidatePath);
    if (mutation === "status") item.status = "DRAFT";
    if (mutation === "identity") item.name = "other";
    if (mutation === "slot") item.meta.element = { slot: "sections.other" };
    if (mutation === "version") input = { ...input, version: Number.MAX_SAFE_INTEGER + 1 };
    save(candidatePath, item);
    if (mutation === "utf8") {
      item.meta.note = "\ufffd"; save(candidatePath, item);
      const bytes = readFileSync(candidatePath), offset = bytes.indexOf(Buffer.from("\ufffd"));
      writeFileSync(candidatePath, Buffer.concat([bytes.subarray(0, offset), Buffer.from([0xff]), bytes.subarray(offset + 3)]));
    }
    input = { ...input, contentHash: sha256Hex(readFileSync(candidatePath)) }; approve(); expectUnchangedRefusal();
  });

  it.each(["json", "schema", "drift"]) ("preserves an invalid previous pin (%s)", mutation => {
    priorPin();
    if (mutation === "json") writeFileSync(pinPath, "{");
    if (mutation === "schema") save(pinPath, { ...load(pinPath), pinnedBy: "ownerless" });
    if (mutation === "drift") save(pinPath, { ...load(pinPath), sha256: "0".repeat(64) });
    input = { ...input, expectedPinHash: sha256Hex(readFileSync(pinPath)) }; expectUnchangedRefusal();
  });

  it("requires an explicit previous-pin precondition and refuses a stale decision without overwriting", () => {
    priorPin();
    input = { ...input, expectedPinHash: null }; expectUnchangedRefusal();
    input = { ...input, expectedPinHash: undefined } as unknown as CanonicalSelectionInput; expectUnchangedRefusal();
  });

  it("replaces an intact pin only under its exact raw-byte precondition", () => {
    priorPin(); approve();
    const result = persistCanonicalSelection(input);
    expect(result.pin.pinnedBy).toBe(`owner:${reference}`);
    expect(result.pinHash).not.toBe(input.expectedPinHash);
    expectUnchangedRefusal();
  });

  it("refuses an occupied guard without taking it over", () => {
    writeFileSync(`${pinPath}.lock`, "another writer");
    expectUnchangedRefusal();
    expect(readFileSync(`${pinPath}.lock`, "utf8")).toBe("another writer");
  });

  it.each(["candidate", "approval", "pin", "ancestor"]) ("refuses a %s symlink", mutation => {
    if (mutation === "pin") priorPin();
    const path = mutation === "candidate" ? candidatePath : mutation === "approval" ? join(root, "approvals.json") : mutation === "pin" ? pinPath : join(dir, "candidates");
    const outside = join(root, `outside-${mutation}`);
    if (mutation === "ancestor") {
      mkdirSync(outside); writeFileSync(join(outside, "hero-v1.json"), readFileSync(candidatePath)); rmSync(path, { recursive: true });
    } else { writeFileSync(outside, readFileSync(path)); rmSync(path); }
    symlinkSync(outside, path);
    expectUnchangedRefusal();
  });

  it("refuses IA position drift and path escape before writing", () => {
    const path = join(root, "agents/designer/ia.json"), ia = load(path);
    ia.nodes[0].children[0].id = ".."; save(path, ia); expectUnchangedRefusal();
  });

  it("does not fall back to legacy selection when the canonical IA is absent", () => {
    rmSync(join(root, "agents/designer/ia.json"));
    save(join(root, "selection.json"), { schema: "clossys.selection/1", pins: {}, history: [] });
    expectUnchangedRefusal();
  });
});
