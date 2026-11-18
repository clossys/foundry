/**
 * requests.open-fix over the clossys.queue-entry/1 entries still under queue.fix (foundry-build-0048 U7 r3): the one
 * strict reader (queue/legacy-fix.ts) fails closed. An entry that is not closed holds its slot open whatever its
 * decider, one that does not read (no status, a status the schema refuses, no subject, a hidden file) is refused by
 * its path, and nothing throws.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { raiseEntry } from "../loop/route.js";
import { OPEN_FIX, requestsWorld, type RequestsWorld } from "../conform/__fixtures__/requests-world.js";
import { openFixes } from "./gates.js";

const worlds: RequestsWorld[] = [];
afterEach(() => { for (const world of worlds.splice(0)) world.dispose(); });
const make = async (): Promise<RequestsWorld> => { const world = await requestsWorld(); worlds.push(world); return world; };
const DIR = "clossys/agents/producer/queue.fix/entries";

/** A valid /1 queue.fix entry about the release's hero, raised by the production raiser, then edited and moved. */
function legacyFix(root: string, slug: string, edit: (doc: Record<string, unknown>) => Record<string, unknown>, name?: string): { id: string; path: string } {
  const { entry } = raiseEntry(root, { queue: "queue.fix", decider: "agent:designer", subject: { to: "designer/sections.hero" as never, rel: "input" }, ask: "the hero overflows", slug }, "2026-11-17T09:00:00Z", false);
  const from = join(root, DIR, `${entry.id}.json`);
  const doc = edit(JSON.parse(readFileSync(from, "utf8")) as Record<string, unknown>);
  const path = `${DIR}/${name ?? `${entry.id}.json`}`;
  writeFileSync(join(root, path), `${JSON.stringify(doc)}\n`);
  if (name) rmSync(from);
  return { id: entry.id, path };
}
const answered = (doc: Record<string, unknown>) => ({
  ...doc, status: "answered",
  events: [...(doc.events as Record<string, unknown>[]), { at: "2026-11-17T09:30:00Z", op: "answered", by: "agent:designer", via: "cli", answer: "fixed" }],
});

describe("requests.open-fix over queue-entry/1 fixes (T10, T11)", () => {
  const CASES: readonly [string, (doc: Record<string, unknown>) => Record<string, unknown>][] = [
    ["no status", ({ status: _status, ...doc }) => doc],
    ["status opne", doc => ({ ...doc, status: "opne" })],
    ["no subject", ({ subject: _subject, ...doc }) => doc],
  ];

  it.each(CASES)("T10: a /1 fix with %s fails the gate by its path, without a throw", { timeout: 60_000 }, async (_label, edit) => {
    const world = await make();
    const fix = legacyFix(world.root, "broken-hero", edit);
    let findings: ReturnType<typeof openFixes> = [];
    expect(() => { findings = openFixes(world.root); }).not.toThrow();
    expect(findings).toContainEqual(expect.objectContaining({ check: "requests.open-fix", subject: "producer/queue.fix", detail: expect.stringMatching(new RegExp(`^${fix.path.replace(/[.]/g, "\\.")} does not read`)) }));
  });

  it("T10: an open /1 fix decided by the owner holds the slot open: the gate fails on its subject", { timeout: 60_000 }, async () => {
    const world = await make();
    const fix = legacyFix(world.root, "owner-hero", doc => ({ ...doc, decider: "owner" }));
    expect(openFixes(world.root)).toContainEqual(expect.objectContaining({ check: "requests.open-fix", subject: "designer/sections.hero", detail: `open queue.fix#${fix.id}: the release reads this slot` }));
  });

  it("T10: an answered /1 fix (status and events agreeing) no longer holds the slot", { timeout: 60_000 }, async () => {
    const world = await make();
    legacyFix(world.root, "answered-hero", answered);
    expect(openFixes(world.root).map(finding => finding.subject)).toEqual([OPEN_FIX]);
  });

  it("T11: a hidden .x.json fix, /1 or kind fix, fails the gate by its path", { timeout: 60_000 }, async () => {
    const world = await make();
    // A hidden copy of an answered (closed) /1 fix: hidden is never closed.
    const hidden = legacyFix(world.root, "hidden-hero", answered, ".x.json");
    // A hidden copy of the world's open kind fix entry (clossys.queue-entry/2).
    const open = world.raised.fix.find(item => item.target === OPEN_FIX)!;
    writeFileSync(join(world.root, DIR, ".y.json"), readFileSync(join(world.root, DIR, `${open.id}.json`)));
    const details = openFixes(world.root).filter(finding => finding.subject === "producer/queue.fix").map(finding => finding.detail);
    expect(details).toContainEqual(expect.stringMatching(new RegExp(`^${hidden.path.replace(/[.]/g, "\\.")} does not read .*hidden file`)));
    expect(details).toContainEqual(expect.stringMatching(new RegExp(`^${DIR.replace(/[.]/g, "\\.")}/\\.y\\.json does not read .*hidden file`)));
  });
});

describe("requests.open-fix over every work folder (U7 r4)", () => {
  it("T15: a kind fix filed under another folder, or a file there that does not read, fails the gate; an unreadable change or slot entry does not", { timeout: 60_000 }, async () => {
    const world = await make();
    const open = world.raised.fix.find(item => item.target === OPEN_FIX)!;
    const changes = "clossys/agents/producer/queue.change/entries", slots = "clossys/agents/producer/queue.slot/entries";
    const baseline = openFixes(world.root).length;
    // The open fix copied into queue.change: a fix entry the reader of one folder would miss.
    writeFileSync(join(world.root, changes, `${open.id}.json`), readFileSync(join(world.root, DIR, `${open.id}.json`)));
    writeFileSync(join(world.root, slots, "20261120T0000Z-slot-broken.json"), "{ not json");
    // A change entry that does not read (an unknown field) says it is a change: no fix hides there.
    const change = world.raised.change[0]!;
    const changeFile = join(world.root, changes, `${change.id}.json`);
    writeFileSync(changeFile, `${JSON.stringify({ ...JSON.parse(readFileSync(changeFile, "utf8")), stray: true })}\n`);
    const findings = openFixes(world.root);
    expect(findings).toContainEqual(expect.objectContaining({ check: "requests.open-fix", subject: "producer/queue.change", detail: expect.stringMatching(new RegExp(`^${changes.replace(/[.]/g, "\\.")}/${open.id}\\.json does not read \\(a fix entry is in queue\\.change\\)`)) }));
    expect(findings).toContainEqual(expect.objectContaining({ check: "requests.open-fix", subject: "producer/queue.slot", detail: expect.stringMatching(/queue\.slot\/entries\/20261120T0000Z-slot-broken\.json does not read \(not JSON/) }));
    expect(findings.filter(finding => finding.detail.includes(change.id))).toEqual([]);
    expect(findings).toHaveLength(baseline + 2);
  });
});
