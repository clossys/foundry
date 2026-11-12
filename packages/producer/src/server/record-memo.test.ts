// R2F-C6: the Producer server keeps the one reader's answers between changes of the watched
// `clossys/agents` tree, so Studio's theme, library selection, slot census and slot detail stop
// re-reading, re-listing and re-hashing unchanged slot folders on every request. The memo must give
// byte-identical answers, read nothing on an unchanged tree, and see a live-save on the next request.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flatConsumer } from "../cli/__fixtures__/flat-consumer.js";
import { SLOT_AGENTS, type SlotAgent } from "../records/slot-model/index.js";
import { writeCandidate, writePin } from "../records/slot-write.js";
import { listSlots, watchSlotModel, withSlotReadScope } from "../records/slots.js";
import { librarySelection } from "./library-selection.js";
import { slotCensus } from "./slot-census.js";
import { slotDetail } from "./slot-detail.js";
import { studioTheme } from "./theme.js";

const fs = createRequire(import.meta.url)("node:fs") as Record<string, unknown>;
const COUNTED = ["readFileSync", "readdirSync", "lstatSync", "statSync", "existsSync", "openSync"] as const;
const READS = new Set<string>(["readFileSync", "readdirSync", "openSync"]);

let root: string, library: string, agents: string, stop: (() => void) | undefined, events: number, waiters: (() => void)[];
beforeEach(() => {
  root = flatConsumer([...SLOT_AGENTS]);
  library = join(root, "clossys");
  agents = join(library, "agents");
  stop = undefined; events = 0; waiters = [];
}, 30_000);
afterEach(() => { stop?.(); rmSync(root, { recursive: true, force: true }); });

/** Arms the memo through the server's own watcher; resolves once stray fixture events have settled. */
async function arm(): Promise<void> {
  stop = await watchSlotModel(library, () => { events++; for (const wake of waiters.splice(0)) wake(); }, { memo: true });
  await new Promise(resolve => setTimeout(resolve, 300));
}
/** Resolves on the next watcher event (a live-save is seen by the request its event triggers). */
const nextEvent = () => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("no watcher event")), 5_000);
  waiters.push(() => { clearTimeout(timer); setTimeout(resolve, 50); });
});

/** A few slots of every agent, the themes and a pinned component among them. */
function sample(): { agent: SlotAgent; id: string }[] {
  return SLOT_AGENTS.flatMap(agent => {
    const slots = listSlots(library, agent);
    const picked = agent === "designer"
      ? [...slots.filter(entry => entry.id.startsWith("themes.")).slice(0, 2), ...slots.filter(entry => entry.pin && !entry.id.startsWith("themes.")).slice(0, 2)]
      : slots.slice(0, 2);
    return picked.map(entry => ({ agent, id: entry.id }));
  });
}
/** What Studio's requests answer: /api/config's theme and selection, /api/slots/census, /api/slots/<agent>/<id>. */
async function requests(slots: readonly { agent: SlotAgent; id: string }[]): Promise<string> {
  const theme = await studioTheme(root);
  const selection = librarySelection(library);
  const census = withSlotReadScope(() => slotCensus(library));
  const details = slots.map(({ agent, id }) => withSlotReadScope(() => slotDetail(root, agent, id)));
  return JSON.stringify({ theme, selection, census, details });
}

/** Counts the fs calls made below the watched folder (`calls`) and on the folder itself (`folder`) while `run` runs. */
async function counting<T>(run: () => Promise<T>): Promise<{ value: T; calls: Record<string, number>; folder: number }> {
  const originals = Object.fromEntries(COUNTED.map(name => [name, fs[name]]));
  const calls: Record<string, number> = {};
  let folder = 0;
  for (const name of COUNTED) {
    const original = originals[name] as (...args: unknown[]) => unknown;
    fs[name] = function (this: unknown, ...args: unknown[]) {
      const path = typeof args[0] === "string" ? args[0] : "";
      if (path === agents) folder++;
      else if (path.startsWith(agents + sep)) calls[name] = (calls[name] ?? 0) + 1;
      return original.apply(this, args);
    };
  }
  syncBuiltinESMExports();
  try { return { value: await run(), calls, folder }; }
  finally { Object.assign(fs, originals); syncBuiltinESMExports(); }
}
const total = (calls: Record<string, number>) => Object.values(calls).reduce((sum, count) => sum + count, 0);
const reads = (calls: Record<string, number>) => Object.entries(calls).reduce((sum, [name, count]) => sum + (READS.has(name) ? count : 0), 0);

describe("the record memo", () => {
  it("answers byte-identically to the unmemoised reader", async () => {
    const slots = sample();
    expect(slots.length).toBeGreaterThan(6);
    const uncached = await requests(slots);
    await arm();
    expect(await requests(slots)).toBe(uncached);
    expect(await requests(slots)).toBe(uncached);
    stop!(); stop = undefined;
    expect(await requests(slots)).toBe(uncached);
  }, 60_000);

  it("reads no slot file on a repeated request while nothing changed", async () => {
    const slots = sample();
    const unwatched = await counting(() => requests(slots));
    // Without the memo every request re-reads the tree: the counter sees the reads it removes.
    expect(reads(unwatched.calls)).toBeGreaterThan(500);
    await arm();
    const first = await counting(() => requests(slots));
    expect(reads(first.calls)).toBeGreaterThan(0);
    const again = await counting(() => requests(slots));
    expect(events).toBe(0);
    expect(again.value).toBe(first.value);
    // Nothing below the watched folder is touched: no read, listing, stat or existence check.
    expect(again.calls).toEqual({});
    expect(reads(again.calls)).toBe(0);
    // Only the folder's own identity check, about once per read scope (theme, selection, census, each detail).
    expect(again.folder).toBeGreaterThanOrEqual(3 + slots.length);
    expect(again.folder).toBeLessThan(3 * (3 + slots.length));
    expect(total(unwatched.calls)).toBeGreaterThan(1000);
  }, 60_000);

  it("sees a live-save on the next request: a new pinned theme candidate, an edited record, a removed pin", async () => {
    const slots = sample();
    await arm();
    const before = await requests(slots);
    const accent = listSlots(library, "designer").find(entry => entry.id === "themes.accent")!;
    expect(accent.pin).toBeTruthy();
    const pinned = JSON.parse(readFileSync(join(accent.dir, "candidates", accent.pin!.candidate), "utf8"));
    expect(JSON.parse(before).theme.css).not.toContain("#0A0B0C");

    // `clossys pin`'s own writer: a new candidate version, pinned.
    const event = nextEvent();
    const written = writeCandidate(library, "designer", "themes.accent", "accent", { ...pinned, cssVars: { ...pinned.cssVars, light: { accent: "#0A0B0C" } } });
    writePin(library, "designer", "themes.accent", written.name, { decidedBy: "planner", basis: "planner", at: "2026-11-12T00:00:00Z" });
    await event;
    const saved = JSON.parse(await requests([{ agent: "designer", id: "themes.accent" }]));
    expect(saved.theme.source).toBe("consumer");
    expect(saved.theme.css).toContain("--accent: #0A0B0C;");
    expect(saved.selection.leaves.find((leaf: { leaf: string }) => leaf.leaf === "themes.accent").fill).toBe(`accent@v${/-v(\d+)\./.exec(written.name)![1]}`);
    expect(saved.details[0].candidates.map((candidate: { name: string }) => candidate.name)).toContain(written.name);
    expect(saved.details[0].pin.candidate).toBe(written.name);

    // A record edited in place: the pinned candidate drifts from its pin.
    const drift = nextEvent();
    const file = join(accent.dir, "candidates", written.name);
    writeFileSync(file, readFileSync(file, "utf8") + "\n");
    await drift;
    const drifted = JSON.parse(await requests([]));
    expect(drifted.theme.source).toBe("error");
    expect(drifted.census.designer.rows.find((row: { id: string }) => row.id === "themes.accent").pin).toBe("hash-drift");

    // A pin removed.
    const unpin = nextEvent();
    rmSync(join(accent.dir, "pin.json"));
    await unpin;
    const unpinned = JSON.parse(await requests([]));
    expect(unpinned.census.designer.rows.find((row: { id: string }) => row.id === "themes.accent").pin).toBe("missing");
    expect(unpinned.selection.leaves.some((leaf: { leaf: string }) => leaf.leaf === "themes.accent")).toBe(false);

    // And what the memo answers now is what an unmemoised read of the changed tree answers.
    const memoised = await requests(slots);
    stop!(); stop = undefined;
    expect(memoised).toBe(await requests(slots));
  }, 60_000);
});
