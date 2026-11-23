/**
 * CONSISTENCY fix round 1 (foundry-build-0048, planner ruling on review-consistency-blindA B1). A slot counts as used
 * only along consumedBy edges that end at a publication, or at the loop runner for an agent `loop.*` slot itself: the
 * runner walk stops at the loop slot and never follows slot names written inside a loop version. So a leaf a loop
 * version names and no publication reaches stays an orphan, is not adopted, and the adopt re-run takes it out of the
 * tree (recording code as its actor). Unreadable Publisher package data refuses by name. The ia sync head counts seats
 * and unconsumed leaves apart, and the seat remedy carries --prompt-file on every llm branch.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runIaOrphans } from "../check/ia-orphans.js";
import { CONSUMED_AGENTS, consumedIds, consumedLeaves } from "../records/slot-model/consumed.js";
import { designerIa, writerIa } from "../records/slot-model/foundry-ia.js";
import { knownSlots, seatRemedy, syncPlan, syncState } from "../records/slot-model/ia-sync.js";
import { runCli } from "./main.js";
import { SEAT_USAGE } from "./owner.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const tempDir = (prefix: string) => { const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix))); dirs.push(dir); return dir; };

/** The legal-document leaf: the package loop.choose names it in an owner-pick step condition, and no publication reaches it. */
const NAMED = "writer/narratives.legal-document";

/** A consumer as the dogfood flow leaves it: config --init, init, each consumed agent adopted, init again (loops pinned). */
async function world(prefix: string): Promise<string> {
  const root = tempDir(prefix);
  const at = ["--root", root];
  expect((await runCli(["config", "--init", ...at], root)).exitCode).toBe(0);
  expect((await runCli(["init", ...at], root)).exitCode).toBe(0);
  for (const agent of CONSUMED_AGENTS) {
    const adopt = await runCli(["ia", agent, "--adopt", ...at], root);
    expect(adopt.exitCode, adopt.message).toBe(0);
  }
  const init = await runCli(["init", ...at], root);
  expect(init.exitCode, init.message).toBe(0);
  return root;
}
/** The pinned loop version file of `<agent>/<loop>` in the consumer. */
function pinnedVersion(root: string, agent: string, loop: string): string {
  const dir = join(root, "clossys", "agents", agent, loop);
  const pin = JSON.parse(readFileSync(join(dir, "pin.json"), "utf8")) as { candidate: string };
  return join(dir, "candidates", pin.candidate);
}
/** Writes the slot.json of one package leaf exactly as a full package sync would, placing it in no ia.json. */
function placeFolder(root: string, agent: "designer" | "writer", id: string): void {
  const consumer = join(root, "clossys");
  const full = syncState(consumer, agent, agent === "designer" ? designerIa() : writerIa());
  const plan = syncPlan(consumer, agent, knownSlots(consumer, agent, full), full);
  if ("error" in plan) throw new Error(plan.error);
  const file = join(consumer, "agents", agent, id, "slot.json");
  const write = plan.writes.find(([path]) => path === file);
  if (!write) throw new Error(`no slot.json planned for ${agent}/${id}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, write[1]);
}
const ledgerEvents = (file: string): { by?: string; adopt?: string; cli?: string; fields?: { adopt?: string; cli?: string } }[] => {
  const doc = JSON.parse(readFileSync(file, "utf8")) as { events?: unknown[] } | unknown[];
  return (Array.isArray(doc) ? doc : (doc as { events?: unknown[] }).events ?? []) as never;
};

describe("the runner walk stops at the agent loop slot (fix r1, B1)", () => {
  it("a leaf only a loop version names is not consumed, not adopted, and stays an orphan", async () => {
    const root = await world("fixr1-loopname-");
    const choose = pinnedVersion(root, "writer", "loop.choose");
    // Not vacuous: the pinned writer loop.choose version names the legal-document leaf.
    expect(readFileSync(choose, "utf8")).toContain(`"${NAMED}"`);
    expect(consumedLeaves(root).has(NAMED)).toBe(false);
    expect(existsSync(join(root, "clossys", "agents", "writer", "narratives.legal-document"))).toBe(false);
    expect(runIaOrphans(root).findings).toEqual([]);

    // Any leaf a loop version names, with no publication reaching it: written into the pinned version, it stays an
    // orphan and unconsumed (the runner consumes the loop slot itself, never what its version names).
    const consumed = consumedIds(consumedLeaves(root), "designer");
    const leaf = [...designerIa().slots.keys()].find(id => !consumed.has(id))!;
    expect(leaf).toBeDefined();
    placeFolder(root, "designer", leaf);
    const doc = JSON.parse(readFileSync(choose, "utf8")) as { content: Record<string, unknown> };
    writeFileSync(choose, `${JSON.stringify({ ...doc, content: { ...doc.content, named: [`designer/${leaf}`] } }, null, 2)}\n`);
    expect(readFileSync(choose, "utf8")).toContain(`designer/${leaf}`);
    expect(runIaOrphans(root).findings.map(finding => finding.subject)).toEqual([`designer/${leaf}`]);
    expect(consumedLeaves(root).has(`designer/${leaf}`)).toBe(false);
    // Its runner still consumes the loop slot itself.
    expect(runIaOrphans(root).findings.some(finding => /\/loop\./.test(finding.subject))).toBe(false);
  }, 240_000);

  it("a placed leaf only a loop version names leaves the tree through the adopt re-run, recorded as code", async () => {
    const root = await world("fixr1-prune-");
    const consumer = join(root, "clossys");
    // A full (pre-D5) writer sync places every package leaf, legal-document among them.
    const full = syncState(consumer, "writer", writerIa());
    const plan = syncPlan(consumer, "writer", knownSlots(consumer, "writer", full), full);
    if ("error" in plan) throw new Error(plan.error);
    for (const [path, bytes] of plan.writes) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); }
    expect(readFileSync(pinnedVersion(root, "writer", "loop.choose"), "utf8")).toContain(`"${NAMED}"`);
    expect(syncState(consumer, "writer").unconsumed).toContain("narratives.legal-document");
    expect(runIaOrphans(root).findings.map(finding => finding.subject)).toContain(NAMED);

    const pruned = await runCli(["ia", "writer", "--adopt", "--root", root], root);
    expect(pruned.exitCode, pruned.message).toBe(0);
    expect((pruned as { output?: { removed?: string[] } }).output?.removed).toContain("narratives.legal-document");
    expect(existsSync(join(consumer, "agents", "writer", "narratives.legal-document"))).toBe(false);
    expect(runIaOrphans(root).findings).toEqual([]);
    const events = ledgerEvents(join(consumer, "agents", "writer", "ledger.json"));
    const prune = events.filter(event => (event.fields?.adopt ?? event.adopt) === "prune-unconsumed");
    expect(prune).toHaveLength(1);
    expect(prune[0]).toMatchObject({ by: "code" });
    expect(prune[0]!.fields?.cli ?? prune[0]!.cli).toBe("clossys ia --adopt");
  }, 240_000);
});

describe("the remaining fix r1 items", () => {
  it("unreadable Publisher package data refuses the adopt by name and fails ia.orphans by name", async () => {
    const root = tempDir("fixr1-publisher-");
    expect((await runCli(["config", "--init", "--root", root], root)).exitCode).toBe(0);
    // A root with packages/ reads its package data from there (package-path.ts): the Publisher package IA is unreadable.
    const directory = join(root, "packages", "publisher", "src", "catalog", "ia", "directory.json");
    mkdirSync(dirname(directory), { recursive: true });
    writeFileSync(directory, "{ not json\n");
    const listing = (dir: string): string[] => readdirSync(dir, { recursive: true }).map(String).sort();
    // The Director adopt places its whole catalog (CHAT-DIR), so it reads no Publisher data; a scoped adopt refuses.
    const director = await runCli(["ia", "director", "--adopt", "--root", root], root);
    expect(director.exitCode, director.message).toBe(0);
    const before = listing(join(root, "clossys"));
    const refused = await runCli(["ia", "designer", "--adopt", "--root", root], root);
    expect(refused.exitCode).toBe(1);
    expect(refused.message).toMatch(/^ia refused: the Publisher package IA is missing or unreadable \(.*directory\.json\)/);
    expect(existsSync(join(root, "clossys", "agents", "designer", "ia.json"))).toBe(false);
    expect(listing(join(root, "clossys"))).toEqual(before);
    const check = runIaOrphans(root);
    expect(check.findings).toContainEqual({ subject: "@clossys/publisher", detail: expect.stringContaining("the Publisher package IA is missing or unreadable") });
    // A Publisher package folder without its IA file refuses the same way (missing is unreadable).
    rmSync(directory);
    const missing = await runCli(["ia", "designer", "--adopt", "--root", root], root);
    expect(missing.exitCode).toBe(1);
    expect(missing.message).toContain("ia refused: the Publisher package IA is missing or unreadable");
    expect(listing(join(root, "clossys"))).toEqual(before);
  }, 120_000);

  it("ia sync counts seats and unconsumed leaves apart in its head line", async () => {
    const root = tempDir("fixr1-head-");
    const at = ["--root", root];
    expect((await runCli(["config", "--init", ...at], root)).exitCode).toBe(0);
    for (const agent of CONSUMED_AGENTS) expect((await runCli(["ia", agent, "--adopt", ...at], root)).exitCode).toBe(0);
    const consumer = join(root, "clossys");
    const full = syncState(consumer, "designer", designerIa());
    const plan = syncPlan(consumer, "designer", knownSlots(consumer, "designer", full), full);
    if ("error" in plan) throw new Error(plan.error);
    for (const [path, bytes] of plan.writes) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); }
    const n = syncState(consumer, "designer").unconsumed.length;
    expect(n).toBeGreaterThan(1);
    const check = await runCli(["ia", "sync", "--agent", "designer", "--check", ...at], root);
    expect(check.exitCode, check.message).toBe(0);
    const head = check.message.split("\n")[0]!;
    expect(head).toContain(`${n} unconsumed package leaves`);
    expect(head).not.toMatch(/seats? pending/);
  }, 180_000);

  it("the seat remedy carries --prompt-file on every llm branch, as the seat usage requires", () => {
    const remedy = seatRemedy("ia");
    expect(SEAT_USAGE).toContain("(--model <id> --tier low|mid|high | --llm-from <step>) --prompt-file <path>");
    expect(remedy).toContain("((--model <id> --tier low|mid|high | --llm-from <step>) --prompt-file <path> | --no-llm)");
    // Each llm alternative is followed by --prompt-file before the no-llm one.
    const llm = remedy.slice(remedy.indexOf("((") + 2, remedy.indexOf(") --prompt-file"));
    expect(llm.split(" | ")).toEqual(["--model <id> --tier low|mid|high", "--llm-from <step>"]);
  });
});
