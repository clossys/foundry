/**
 * `clossys ia sync` records every slot.json it writes (R14.1, foundry-build-0048 U31): one slot-ledger `slot`
 * event (verb ia) per slot.json created or changed, carrying the written bytes' sha256, and no event on a re-sync
 * that changes nothing. Synthetic: a temp Tallyhouse copy (records/__fixtures__/slot2-workspace.ts).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runIaSyncCli } from "./ia-sync.js";
import { AT, LATER, packageBaseOf, slot2Ids, tallyhouseWorld, type Workspace } from "../records/__fixtures__/slot2-workspace.js";

const HERO = "sections.hero.copy", LEXICON = "lexicon.sentence-length";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function world(): Workspace {
  const ws = tallyhouseWorld();
  roots.push(ws.root);
  rmSync(join(ws.root, "clossys/agents/designer/assets.lockup"), { recursive: true });
  return ws;
}
type Event = { op: string; verb: string; by: string; at: string; records?: { file: string; sha256: string | null }[]; kind?: string; action?: string };
const eventsOf = (ws: Workspace, agent: string, id: string): Event[] => {
  const file = join(dirname(ws.file(agent as never, id)), "ledger.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { events: Event[] }).events : [];
};
const counts = (ws: Workspace) => new Map(slot2Ids(ws.root).map(([agent, id]) => [`${agent}/${id}`, eventsOf(ws, agent, id).length]));
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

describe("clossys ia sync: one slot-ledger event per slot.json written (R14.1)", { timeout: 120_000 }, () => {
  it("records each created or changed slot.json once, and nothing on a no-op re-sync", async () => {
    const ws = world();
    rmSync(ws.file("designer", "themes.primary"));
    const before = counts(ws);
    const first = await runIaSyncCli(["sync", "--at", AT], ws.root);
    const changes = (first.output as { changes: { agent: string; slot: string; action: string }[] }).changes;
    expect(changes.length).toBeGreaterThan(1);
    expect(changes).toContainEqual({ agent: "designer", slot: "themes.primary", action: "added" });
    const changed = new Set(changes.map(change => `${change.agent}/${change.slot}`));
    const after = counts(ws);
    for (const [key, total] of after) expect(total - (before.get(key) ?? 0), key).toBe(changed.has(key) ? 1 : 0);
    for (const change of changes) {
      const last = eventsOf(ws, change.agent, change.slot).at(-1)!;
      expect(last).toMatchObject({ op: "slot", verb: "ia", by: "producer", at: AT, kind: "sync", action: change.action, model: "none", tier: "none" });
      expect(last.records).toEqual([{ file: "slot.json", sha256: sha(ws.text(change.agent as never, change.slot)) }]);
    }

    const again = await runIaSyncCli(["sync", "--at", LATER], ws.root);
    expect(again.exitCode, again.message).toBe(0);
    expect(again.message).toMatch(/^ia sync: 0 slot\(s\) written/);
    expect(counts(ws)).toEqual(after);
  });

  it("records a changed slot (a package regroup) with one more event, and no unchanged slot gains one", async () => {
    const ws = world();
    await runIaSyncCli(["sync", "--at", AT], ws.root);
    const slot = ws.read("writer", HERO);
    ws.writeBase({ ...packageBaseOf(slot), ia: ws.read("writer", LEXICON).ia }, "1.1.0");
    const before = counts(ws);
    const moved = await runIaSyncCli(["sync", "--at", LATER], ws.root);
    expect(moved.exitCode, moved.message).toBe(0);
    expect(moved.message).toContain(`moved writer/${HERO}`);
    // The move may also re-order the target L2's other slots: each slot the sync reports gains one event, no other slot any.
    const changed = new Set((moved.output as { changes: { agent: string; slot: string }[] }).changes.map(change => `${change.agent}/${change.slot}`));
    expect(changed.has(`writer/${HERO}`)).toBe(true);
    for (const [key, total] of counts(ws)) expect(total - (before.get(key) ?? 0), key).toBe(changed.has(key) ? 1 : 0);
    expect(eventsOf(ws, "writer", HERO).at(-1)).toMatchObject({ op: "slot", verb: "ia", at: LATER, action: "moved", records: [{ file: "slot.json", sha256: sha(ws.text("writer", HERO)) }] });
  });

  it("--check writes no slot.json and no event", async () => {
    const ws = world();
    const before = counts(ws);
    const check = await runIaSyncCli(["sync", "--check"], ws.root);
    expect(check.exitCode).toBe(1);
    expect(counts(ws)).toEqual(before);
  });
});
