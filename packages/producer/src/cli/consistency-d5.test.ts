/**
 * CONSISTENCY round 2 (foundry-build-0048 D5). Option 1: `clossys ia <agent> --adopt` places only the package leaves a
 * declared or seated publication reaches, and its re-run takes already placed unconsumed leaves out of the tree.
 * Option 3: each agent loop slot carries the runner's consumedBy edge, which ia.orphans walks (not an exemption).
 * The init prelude judges each of its checks by its own run, never by the step's exit.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runIaOrphans } from "../check/ia-orphans.js";
import { AGENT_LOOPS } from "../loop/agent-loops-ia.js";
import { runnerEdge } from "../loop/agent-loop-adopt.js";
import { ledgerDir, runInit, type RunHooks } from "../loop/runner.js";
import { CONSUMED_AGENTS, consumedIds, consumedLeaves } from "../records/slot-model/consumed.js";
import { designerIa, directorIa, writerIa } from "../records/slot-model/foundry-ia.js";
import { failsSync, knownSlots, syncDrift, syncPlan, syncState } from "../records/slot-model/ia-sync.js";
import type { LedgerEntry } from "../records/types.js";
import { runCli } from "./main.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const tempDir = (prefix: string) => { const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix))); dirs.push(dir); return dir; };
const PACKAGES = { director: directorIa, designer: designerIa, writer: writerIa } as const;

type IaJson = { nodes: { children: { slots: string[] }[] }[] };
const placed = (root: string, agent: string): Set<string> => {
  const ia = JSON.parse(readFileSync(join(root, "clossys", "agents", agent, "ia.json"), "utf8")) as IaJson;
  return new Set(ia.nodes.flatMap(node => node.children.flatMap(child => child.slots)));
};
const packagePlaced = (root: string, agent: keyof typeof PACKAGES): string[] => {
  const ids = new Set(PACKAGES[agent]().slots.keys());
  return [...placed(root, agent)].filter(id => ids.has(id)).sort();
};
/** Every file under `dir`, relative path to bytes (folders included as entries, so an emptied folder shows). */
function tree(dir: string, base = dir, out: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { out[`${relative(base, path)}/`] = ""; tree(path, base, out); }
    else out[relative(base, path)] = readFileSync(path, "utf8");
  }
  return out;
}
const agentFindings = (root: string, prefix: (subject: string) => boolean) => runIaOrphans(root).findings.filter(finding => prefix(finding.subject));
const leafSubject = (subject: string) => CONSUMED_AGENTS.some(agent => subject.startsWith(`${agent}/`)) && !/\/loop\./.test(subject);

async function adopted(prefix: string): Promise<string> {
  const root = tempDir(prefix);
  const at = ["--root", root];
  expect((await runCli(["config", "--init", ...at], root)).exitCode).toBe(0);
  for (const agent of CONSUMED_AGENTS) {
    const adopt = await runCli(["ia", agent, "--adopt", ...at], root);
    expect(adopt.exitCode, adopt.message).toBe(0);
  }
  return root;
}

describe("ia --adopt places only consumed package leaves (D5 option 1)", () => {
  it("places exactly the leaves a declared or seated publication reaches, and none of them is an orphan", async () => {
    const root = await adopted("d5-adopt-");
    const consumed = consumedLeaves(root);
    let skipped = 0;
    for (const agent of CONSUMED_AGENTS) {
      expect(packagePlaced(root, agent), agent).toEqual([...consumedIds(consumed, agent)].sort());
      skipped += PACKAGES[agent]().slots.size - consumedIds(consumed, agent).size;
    }
    // Not vacuous: the package holds leaves no publication reaches, and the adopt left them in the package.
    expect(skipped).toBeGreaterThan(0);
    // The Director places its whole catalog (CHAT-DIR, ruling B1): each leaf carries the Director reader's edge.
    expect(packagePlaced(root, "director")).toEqual([...directorIa().slots.keys()].sort());
    expect(agentFindings(root, leafSubject)).toEqual([]);
    for (const agent of CONSUMED_AGENTS) expect(syncDrift(join(root, "clossys"), agent).filter(failsSync), agent).toEqual([]);
  }, 120_000);

  it("the re-run takes a full adopt's unconsumed leaves out, refusing while one holds a record, then writes nothing", async () => {
    const root = await adopted("d5-prune-");
    const consumer = join(root, "clossys");
    const fresh = packagePlaced(root, "designer");
    // A full (pre-D5) adopt: the whole package IA synced in, unconsumed leaves included.
    const full = syncState(consumer, "designer", designerIa());
    const plan = syncPlan(consumer, "designer", knownSlots(consumer, "designer", full), full);
    if ("error" in plan) throw new Error(plan.error);
    for (const [path, bytes] of plan.writes) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); }
    const unconsumed = syncState(consumer, "designer").unconsumed;
    expect(unconsumed.length).toBeGreaterThan(0);
    expect([...unconsumed].sort()).toEqual(packagePlaced(root, "designer").filter(id => !fresh.includes(id)));
    // ia.orphans judges them (it fails them); ia sync lists them as pending, naming the adopt re-run.
    expect(agentFindings(root, subject => subject.startsWith("designer/") && !/\/loop\./.test(subject)).length).toBe(unconsumed.length);
    const listed = syncDrift(consumer, "designer").filter(finding => finding.kind === "unconsumed-leaf");
    expect(listed.map(finding => finding.slot).sort()).toEqual([...unconsumed].sort());
    expect(listed.every(finding => !failsSync(finding) && finding.detail.includes("clossys ia designer --adopt"))).toBe(true);

    // A leaf that holds a record (a candidate) refuses the re-run, naming it, and nothing is written.
    const held = unconsumed[0]!;
    const candidate = join(consumer, "agents", "designer", held, "candidates", "hand-v1.json");
    mkdirSync(dirname(candidate), { recursive: true });
    writeFileSync(candidate, "{}\n");
    const before = tree(consumer);
    const refused = await runCli(["ia", "designer", "--adopt", "--root", root], root);
    expect(refused.exitCode).toBe(1);
    expect(refused.message).toContain(held);
    expect(tree(consumer)).toEqual(before);
    rmSync(candidate);
    rmdirSync(dirname(candidate));

    const pruned = await runCli(["ia", "designer", "--adopt", "--root", root], root);
    expect(pruned.exitCode, pruned.message).toBe(0);
    expect(pruned.message).toContain(`took ${unconsumed.length} package leaves`);
    expect(packagePlaced(root, "designer")).toEqual(fresh);
    for (const id of unconsumed) expect(existsSync(join(consumer, "agents", "designer", id)), id).toBe(false);
    expect(syncDrift(consumer, "designer").filter(failsSync)).toEqual([]);
    expect(syncState(consumer, "designer").unconsumed).toEqual([]);
    expect(agentFindings(root, leafSubject)).toEqual([]);

    const settled = tree(consumer);
    const again = await runCli(["ia", "designer", "--adopt", "--root", root], root);
    expect(again.exitCode, again.message).toBe(0);
    expect(again.message).toContain("nothing to remove");
    expect(tree(consumer)).toEqual(settled);
  }, 180_000);
});

describe("agent loop slots: the runner's consumedBy edge (D5 option 3) and the init prelude", () => {
  const hooks = (exit: 0 | 1): RunHooks => ({ guard: { rules: [] }, agent: () => ({ exit: 0, model: "none" }), code: call => ({ exit: call.step === "ia-sync" ? exit : 0 }) });
  const entries = (root: string): string[] => { const dir = ledgerDir(root, "loop.fill"); return existsSync(dir) ? readdirSync(dir) : []; };
  /** The one ledger entry `run` adds (run ids stamped in the same second take a suffix, so names do not sort by time). */
  const entryOf = async (root: string, run: () => Promise<unknown>): Promise<LedgerEntry> => {
    const before = new Set(entries(root));
    await run();
    const added = entries(root).filter(name => !before.has(name));
    expect(added).toHaveLength(1);
    return JSON.parse(readFileSync(join(ledgerDir(root, "loop.fill"), added[0]!), "utf8")) as LedgerEntry;
  };

  it("each loop slot is used by its runner; without the edge it is an orphan again, and init restores it", async () => {
    const root = tempDir("d5-runner-");
    const at = ["--root", root];
    expect((await runCli(["config", "--init", ...at], root)).exitCode).toBe(0);
    expect((await runCli(["init", ...at], root)).exitCode).toBe(0);
    for (const agent of CONSUMED_AGENTS) expect((await runCli(["ia", agent, "--adopt", ...at], root)).exitCode).toBe(0);
    const init = await runCli(["init", ...at], root);
    expect(init.exitCode, init.message).toBe(0);
    const loopSubject = (subject: string) => /^[a-z]+\/loop\./.test(subject) && !subject.startsWith("producer/");
    for (const agent of CONSUMED_AGENTS) for (const loop of AGENT_LOOPS) {
      const file = join(root, "clossys", "agents", agent, loop, "slot.json");
      if (!existsSync(file)) continue;
      const refs = (JSON.parse(readFileSync(file, "utf8")) as { refs: { to: string; rel: string }[] }).refs;
      expect(refs, `${agent}/${loop}`).toContainEqual(runnerEdge(loop));
    }
    expect(agentFindings(root, loopSubject)).toEqual([]);
    expect(runIaOrphans(root).findings).toEqual([]);

    // The prelude: an ia sync that exits 1 while both tree checks pass records them as passed.
    let stopped = { exitCode: -1 };
    const first = await entryOf(root, async () => { stopped = await runInit(root, hooks(1)); });
    expect(stopped.exitCode).toBe(1);
    expect(first).toMatchObject({ status: "stopped", outcome: "init stopped at ia-sync (exit 1)", checks: { "ia.orphans": "pass", "records.computed-match": "pass" } });

    // Without the edge, the loop slot is an orphan again (the edge is a walked ref, not an exemption).
    const file = join(root, "clossys", "agents", "writer", "loop.create", "slot.json");
    const bytes = readFileSync(file, "utf8");
    const doc = JSON.parse(bytes) as { refs: { to: string; rel: string }[] };
    writeFileSync(file, `${JSON.stringify({ ...doc, refs: doc.refs.filter(ref => ref.rel !== "consumedBy") }, null, 2)}\n`);
    expect(agentFindings(root, loopSubject).map(finding => finding.subject)).toEqual(["writer/loop.create"]);
    // An ia sync that exits 0 over that failing check still stops the init, naming the check and the slot.
    let failed = { exitCode: -1 };
    const entry = await entryOf(root, async () => { failed = await runInit(root, hooks(0)); });
    expect(failed.exitCode).toBe(1);
    expect(entry.outcome).toMatch(/^init stopped at ia-sync \(exit 1\): ia\.orphans: writer\/loop\.create /);
    expect(entry.checks).toMatchObject({ "ia.orphans": "fail", "records.computed-match": "pass" });

    const repaired = await runCli(["init", ...at], root);
    expect(repaired.exitCode, repaired.message).toBe(0);
    expect(readFileSync(file, "utf8")).toContain(runnerEdge("loop.create").to);
    expect(agentFindings(root, loopSubject)).toEqual([]);
  }, 240_000);
});
