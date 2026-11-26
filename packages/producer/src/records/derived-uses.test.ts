/**
 * CP1-USES: the derive.uses step (scripts/check-generated-derived.mjs writeUses) writes each slot's computed `uses` as
 * clossys.slot/2 `uses` refs through the logged slot writer (records/slot-write.ts writeSlotUses, called by
 * records/derived-uses.ts): one `slot` event per changed slot, no top-level `uses` key, nothing written for a slot
 * whose set already matches or that has no source. Every world is a mktemp copy of test-fixtures/consumer.
 */
import { cpSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { runCli } from "../cli/main.js";
import { buildContext } from "../constitution/index.js";
import { r05_1 } from "../constitution/rules/r05.js";
import { PRODUCER_ROOT } from "../package-path.js";
import { CODE_ADOPT, CODE_ADOPT_RUNG, stockFilesOf, stockItemOf } from "./code-adopt.js";
import { writeCandidate } from "./slot-write.js";
import { readLedger } from "./slots.js";

const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const REPO = join(PRODUCER_ROOT, "..", "..");
const ITEM = "components.item";
const SEPARATOR = "designer/components.separator";
const AT = "2026-11-26T12:00:00.000Z";
const AGENTS = ["director", "designer", "writer", "publisher"] as const;

interface WriteResult { repaired: string[]; written: string[]; refused: string[]; synced: string[]; unresolved: { slot: string; spec: string }[] }
interface Script {
  writeUses(clossysRoot: string, options?: { root?: string; at?: string }): WriteResult;
  deriveUses(clossysRoot: string, root?: string, unresolved?: { slot: string; spec: string }[]): Map<string, string[]>;
  committedUses(clossysRoot: string): Map<string, string[]>;
}
const script = async (): Promise<Script> => await import(pathToFileURL(join(PRODUCER_ROOT, "scripts", "check-generated-derived.mjs")).href) as Script;

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function world(): { root: string; consumer: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "derived-uses-")));
  roots.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  return { root, consumer: join(root, "clossys") };
}
const slotPath = (consumer: string, key: string) => join(consumer, "agents", ...key.split("/"), "slot.json");
const docOf = (consumer: string, key: string) => JSON.parse(readFileSync(slotPath(consumer, key), "utf8")) as { schema: string; refs: { to: string; rel: string }[]; uses?: unknown };
const usesRefsOf = (consumer: string, key: string) => docOf(consumer, key).refs.filter(ref => ref.rel === "uses").map(ref => ref.to);
const keysOf = (consumer: string) => AGENTS.flatMap(agent => {
  const dir = join(consumer, "agents", agent);
  return existsSync(dir) ? readdirSync(dir).filter(id => existsSync(join(dir, id, "slot.json"))).map(id => `${agent}/${id}`) : [];
});
const bytesOf = (consumer: string) => new Map(keysOf(consumer).map(key => [key, readFileSync(slotPath(consumer, key), "utf8")]));
const deriveEvents = (consumer: string, key: string) =>
  (readLedger(join(consumer, "agents", ...key.split("/")), "slot")?.events ?? []).filter(event => (event as { step?: unknown }).step === "derive.uses");
/**
 * `clossys check --engine`'s findings (chain, index and drift lines). The fixture already carries eight drifted records
 * (retired folders its events still name), so a write is judged by the findings it adds: none.
 */
const engineFindings = async (root: string): Promise<string[]> => {
  const result = await runCli(["check", "--engine", "--root", root], root);
  return result.message.split("\n").filter(line => /^\s+(?:chain|index|drift|layout)\b/.test(line)).sort();
};
const hasNoStock = (root: string, key: string): boolean => {
  const [agent, id] = key.split("/") as [string, string];
  if (agent !== "designer") return true;
  try { return "none" in stockFilesOf(root, id); } catch { return true; }
};
/** Drop the `uses` refs of one slot as an `ia --adopt` store holds them before derive.uses (test setup, not a verb). */
function dropUsesRefs(consumer: string, key: string): void {
  const doc = docOf(consumer, key);
  writeFileSync(slotPath(consumer, key), `${JSON.stringify({ ...doc, refs: doc.refs.filter(ref => ref.rel !== "uses") }, null, 2)}\n`);
}

describe("committedUses (R-USES-COMPUTED's committed side)", () => {
  it("committedUses reads slot/2 uses refs", async () => {
    const { consumer } = world();
    const { committedUses } = await script();
    const doc = docOf(consumer, `designer/${ITEM}`);
    expect(doc.schema).toBe("clossys.slot/2");
    expect(doc.uses).toBeUndefined();
    expect(doc.refs).toContainEqual({ to: SEPARATOR, rel: "uses" });
    expect(committedUses(consumer).get(`designer/${ITEM}`)).toEqual(["components.separator"]);
    // A stray top-level key is not a slot/2 field and is not read.
    writeFileSync(slotPath(consumer, `designer/${ITEM}`), `${JSON.stringify({ ...doc, uses: ["components.button"] }, null, 2)}\n`);
    expect(committedUses(consumer).get(`designer/${ITEM}`)).toEqual(["components.separator"]);
  });
});

describe("derive.uses writes uses refs through the logged slot writer", () => {
  it("derive.uses writes refs with one slot event per changed slot, and `check --engine` reports no drift", async () => {
    const { root, consumer } = world();
    const { writeUses, deriveUses, committedUses } = await script();
    const engineBefore = await engineFindings(root);
    expect(engineBefore.some(line => /derive|uses/.test(line))).toBe(false);
    const before = bytesOf(consumer);
    const derived = deriveUses(consumer, REPO);
    const result = writeUses(consumer, { root: REPO, at: AT });
    expect(result.refused).toEqual([]);
    expect(result.written.length).toBeGreaterThan(0);
    const after = bytesOf(consumer);
    const changed = [...after.keys()].filter(key => after.get(key) !== before.get(key)).sort();
    expect(changed).toEqual([...result.written].sort());
    for (const key of result.written) expect(deriveEvents(consumer, key), key).toHaveLength(1);
    // Every slot the step derived now holds exactly that set (package-synced slots are reported, not written).
    const committed = committedUses(consumer);
    const synced = new Set(result.synced.map(line => line.split(":")[0]));
    for (const [key, list] of derived) if (!synced.has(key)) expect(committed.get(key), key).toEqual(list);
    // A slot with no source is not touched: its bytes, its uses refs included, stay as they were.
    // Judged without the step's own derivation: no pin.json, and no stock files (a Designer slot whose stock ladder,
    // code-adopt.ts stockFilesOf, finds none or cannot read one) or not a Designer slot.
    const unsourced = [...before.keys()].filter(key => !existsSync(join(consumer, "agents", ...key.split("/"), "pin.json")) && hasNoStock(root, key));
    const heldRefs = (text: string) => (JSON.parse(text) as { refs?: { rel: string }[] }).refs?.some(ref => ref.rel === "uses") === true;
    expect(unsourced.filter(key => heldRefs(before.get(key)!)).length).toBeGreaterThan(10);
    for (const key of unsourced) expect(after.get(key), key).toBe(before.get(key));
    // Every write is logged: the engine reports no drift beyond the fixture's own.
    expect(await engineFindings(root)).toEqual(engineBefore);
  }, 120_000);

  it("a second derive.uses writes nothing", async () => {
    const { consumer } = world();
    const { writeUses } = await script();
    expect(writeUses(consumer, { root: REPO, at: AT }).written.length).toBeGreaterThan(0);
    const before = bytesOf(consumer);
    const second = writeUses(consumer, { root: REPO, at: "2026-11-26T12:00:01.000Z" });
    expect(second).toMatchObject({ written: [], repaired: [], refused: [] });
    expect(bytesOf(consumer)).toEqual(before);
  }, 120_000);

  it("no slot/2 doc gains a top-level uses key", async () => {
    const { consumer } = world();
    const { writeUses } = await script();
    const result = writeUses(consumer, { root: REPO, at: AT });
    expect(result.written.length).toBeGreaterThan(0);
    for (const key of keysOf(consumer)) {
      const doc = docOf(consumer, key);
      if (doc.schema === "clossys.slot/2") expect(Object.hasOwn(doc, "uses"), key).toBe(false);
    }
  }, 120_000);
});

describe("derive.uses derives an unpinned slot from its stock reference item", () => {
  it("an unpinned components.item gets uses designer/components.separator from its stock item", async () => {
    const { consumer } = world();
    const { writeUses } = await script();
    expect(existsSync(join(consumer, "agents", "designer", ITEM, "pin.json"))).toBe(false);
    dropUsesRefs(consumer, `designer/${ITEM}`);
    expect(usesRefsOf(consumer, `designer/${ITEM}`)).toEqual([]);
    const result = writeUses(consumer, { root: REPO, at: AT });
    expect(result.written).toContain(`designer/${ITEM}`);
    expect(usesRefsOf(consumer, `designer/${ITEM}`)).toEqual([SEPARATOR]);
    expect(deriveEvents(consumer, `designer/${ITEM}`)).toEqual([expect.objectContaining({ verb: "ia", uses: [SEPARATOR] })]);
    // components.toolbar's stock item (shadcn-aria button-group) imports the separator too.
    expect(usesRefsOf(consumer, "designer/components.toolbar")).toContain(SEPARATOR);
  }, 120_000);

  it("its R05.1 import check then passes", async () => {
    const { root, consumer } = world();
    const { writeUses } = await script();
    dropUsesRefs(consumer, `designer/${ITEM}`);
    const found = stockItemOf(root, ITEM);
    if (!("stock" in found)) throw new Error(found.none);
    const seed = found.stock.seed;
    const written = writeCandidate(consumer, "designer", ITEM, found.stock.item.name, found.stock.item, {
      at: AT, provenance: { verb: "submit", by: CODE_ADOPT }, fields: { basis: "code", rung: CODE_ADOPT_RUNG, seed, ladder: { rung: CODE_ADOPT_RUNG, seed } },
    });
    const importRows = () => r05_1(buildContext(root, consumer)).filter(row => row.slot === ITEM && row.candidate === written.name && /which slot\.json uses does not list/.test(row.reason));
    expect(importRows().map(row => row.reason).join("\n")).toMatch(/imports @\/components\/ui\/separator from slot components\.separator, which slot\.json uses does not list/);
    writeUses(consumer, { root: REPO, at: AT });
    expect(usesRefsOf(consumer, `designer/${ITEM}`)).toEqual([SEPARATOR]);
    expect(importRows()).toEqual([]);
  }, 300_000);

  it("an import no slot installs is reported, not written", async () => {
    const { consumer } = world();
    const { writeUses } = await script();
    const before = usesRefsOf(consumer, "designer/components.field");
    const result = writeUses(consumer, { root: REPO, at: AT });
    expect(result.unresolved).toContainEqual({ slot: "designer/components.field", spec: "@/components/ui/label" });
    expect(result.unresolved).toContainEqual({ slot: "designer/components.form", spec: "@/components/ui/label" });
    for (const key of ["designer/components.field", "designer/components.form"]) {
      expect(usesRefsOf(consumer, key).some(to => /label/.test(to)), key).toBe(false);
    }
    expect(existsSync(join(consumer, "agents", "designer", "components.label"))).toBe(false);
    expect(usesRefsOf(consumer, "designer/components.field")).toEqual(before);
  }, 120_000);
});

describe("derive.uses after ia sync", () => {
  it("ia sync then derive.uses is a no-op", async () => {
    const { root, consumer } = world();
    const { writeUses } = await script();
    writeUses(consumer, { root: REPO, at: AT });
    const derived = bytesOf(consumer);
    const sync = await runCli(["ia", "sync", "--root", root, "--at", "2026-11-26T12:00:02.000Z"], root);
    expect(sync.exitCode, sync.message).toBe(0);
    // The sync keeps the uses refs derive.uses wrote.
    for (const key of keysOf(consumer)) {
      const was = derived.get(key);
      if (was === undefined) continue;
      const usesOf = (text: string) => (JSON.parse(text) as { refs?: { to: string; rel: string }[] }).refs?.filter(ref => ref.rel === "uses") ?? [];
      expect(usesRefsOf(consumer, key), key).toEqual(usesOf(was).map(ref => ref.to));
    }
    const synced = bytesOf(consumer);
    const again = writeUses(consumer, { root: REPO, at: "2026-11-26T12:00:03.000Z" });
    expect(again).toMatchObject({ written: [], repaired: [], refused: [] });
    expect(bytesOf(consumer)).toEqual(synced);
  }, 300_000);
});

describe("derive.uses repairs a stray top-level uses key", () => {
  it("a stray top-level uses key is removed with an event", async () => {
    const { root, consumer } = world();
    const { writeUses } = await script();
    writeUses(consumer, { root: REPO, at: AT });
    const engineBefore = await engineFindings(root);
    const key = `designer/${ITEM}`;
    const clean = readFileSync(slotPath(consumer, key), "utf8");
    // What the old raw writer left: `"uses": []` on a slot/2 doc.
    writeFileSync(slotPath(consumer, key), `${JSON.stringify({ ...JSON.parse(clean), uses: [] }, null, 2)}\n`);
    const events = deriveEvents(consumer, key).length;
    const result = writeUses(consumer, { root: REPO, at: "2026-11-26T12:00:04.000Z" });
    expect(result.repaired).toEqual([key]);
    expect(result.written).toEqual([]);
    const doc = docOf(consumer, key);
    expect(Object.hasOwn(doc, "uses")).toBe(false);
    expect(usesRefsOf(consumer, key)).toEqual([SEPARATOR]);
    const after = deriveEvents(consumer, key);
    expect(after).toHaveLength(events + 1);
    expect(after.at(-1)).toMatchObject({ strayUses: "removed", uses: [SEPARATOR] });
    // The repair is logged: the raw write's drift is gone and no other finding is added.
    expect(await engineFindings(root)).toEqual(engineBefore);
  }, 120_000);
});
