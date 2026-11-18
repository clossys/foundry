/**
 * The request lens on its own world (conform/__fixtures__/requests-world.ts): one request of each kind about every
 * content agent, raised and closed by the production verbs, read by the real conformance model. Q3, Q4 and Q6-Q9 and
 * Q11 judge real entries here (never green by construction), and Q11 proves the release gate refuses the open fix.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runRequestCli } from "../cli/request.js";
import { closeWork, listRequests, readRequest, requestIssues } from "../records/request.js";
import { openFixes } from "../release/gates.js";
import { ASSERTIONS } from "./assertions.js";
import type { ProbeFacts } from "./dogfood.js";
import { CONFORM_AGENTS, readConformModel } from "./model.js";
import { CHANGES, FIXES, NEEDS, OPEN_FIX, requestsWorld, type RequestsWorld } from "./__fixtures__/requests-world.js";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const worlds: RequestsWorld[] = [];
afterEach(() => { for (const world of worlds.splice(0)) world.dispose(); });
const make = async (): Promise<RequestsWorld> => { const world = await requestsWorld(); worlds.push(world); return world; };
const judgeAll = (world: RequestsWorld, ids: readonly string[]) => {
  const model = readConformModel(REPO, world.consumer);
  return Object.fromEntries(model.agents.map(agent => [agent.agent, Object.fromEntries(ids.map(id => [id, ASSERTIONS[id]!(agent, model, {} as ProbeFacts)]))]));
};
const entryFile = (world: RequestsWorld, kind: string, id: string) => join(world.consumer, "agents/producer", `queue.${kind}`, "entries", `${id}.json`);

describe("the request lens world", () => {
  it("holds one slot, change and fix request about every content agent, raised and closed by the verbs", { timeout: 60_000 }, async () => {
    const world = await make();
    const about = (kind: "slot" | "change" | "fix") => new Set(world.raised[kind].map(entry => entry.target.split("/")[0]));
    for (const kind of ["slot", "change", "fix"] as const) expect([...about(kind)].sort(), kind).toEqual([...CONFORM_AGENTS].sort());
    expect(world.raised.slot.map(entry => `${entry.from} -> ${entry.target}`).sort()).toEqual(NEEDS.map(need => `${need.from} -> ${need.to}`).sort());
    for (const kind of ["slot", "change", "fix"] as const) for (const read of listRequests(world.consumer, kind)) expect(read.issues, read.file).toEqual([]);
    // Each closed change and fix carries a producer verified event before its close and notifies its requester.
    for (const entry of [...world.raised.change, ...world.raised.fix.filter(item => item.target !== OPEN_FIX)]) {
      const closed = readRequest(world.consumer, entry.id);
      expect(closed).toMatchObject({ status: "closed", notified: { to: entry.from } });
      const ops = closed.events.map(event => event.op);
      expect(ops.indexOf("verified")).toBeGreaterThan(-1);
      expect(ops.indexOf("verified")).toBeLessThan(ops.indexOf("closed"));
      expect(closed.closed).toBe(closed.events.find(event => event.op === "closed")!.id);
    }
    expect(readRequest(world.consumer, world.raised.fix.find(item => item.target === OPEN_FIX)!.id).status).toBe("open");
    expect(CHANGES.length + FIXES.length + NEEDS.length).toBe(world.raised.change.length + world.raised.fix.length + world.raised.slot.length);
  });

  it("judges real entries: Q3, Q4, Q7, Q8, Q9 and Q11 are green with evidence beyond their fixed floor, Q6 for every issuing agent", { timeout: 60_000 }, async () => {
    const world = await make();
    const cells = judgeAll(world, ["Q3", "Q4", "Q6", "Q7", "Q8", "Q9", "Q11"]);
    for (const agent of CONFORM_AGENTS) {
      for (const id of ["Q3", "Q4", "Q7", "Q8", "Q9", "Q11"]) expect(cells[agent]![id]!.rows, `${agent} ${id}`).toEqual([]);
      // Q3 counts 1 + entries, Q8 judged + held, Q7 closed entries, Q9 1 + agent steps: every one sees entries here.
      expect(cells[agent]!.Q3!.evidence, `${agent} Q3`).toBeGreaterThan(1);
      expect(cells[agent]!.Q7!.evidence, `${agent} Q7`).toBeGreaterThan(0);
      expect(cells[agent]!.Q8!.evidence, `${agent} Q8`).toBeGreaterThan(0);
      expect(cells[agent]!.Q9!.evidence, `${agent} Q9`).toBeGreaterThan(1);
    }
    for (const agent of ["designer", "writer", "publisher"]) {
      expect(cells[agent]!.Q6!.rows, `${agent} Q6`).toEqual([]);
      expect(cells[agent]!.Q6!.evidence, `${agent} Q6`).toBeGreaterThan(0);
    }
    // Q11 judges Writer's open record-slot fix: the gate refuses it (evidence counts it).
    expect(cells.writer!.Q11!.evidence).toBe(2);
  });

  it("Q11: the release gate refuses the open fix on a Writer record slot, and a gate that passes it over is red", { timeout: 60_000 }, async () => {
    const world = await make();
    const open = world.raised.fix.find(item => item.target === OPEN_FIX)!;
    expect(openFixes(world.root)).toEqual([expect.objectContaining({ check: "requests.open-fix", subject: OPEN_FIX, detail: expect.stringContaining(`queue.fix#${open.id}`) })]);
    expect(judgeAll(world, ["Q11"]).writer!.Q11).toMatchObject({ rows: [], evidence: 2 });
  });

  it("Q7: an entry forged closed (status closed, `closed` pointing at its raise) is red in Q1 and Q7, never dropped", { timeout: 60_000 }, async () => {
    const world = await make();
    const open = world.raised.fix.find(item => item.target === OPEN_FIX)!;
    const file = entryFile(world, "fix", open.id);
    const doc = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, `${JSON.stringify({ ...doc, status: "closed", closed: doc.opened, outcome: "fixed", result: OPEN_FIX, notified: { to: "owner", at: doc.createdAt }, closedAt: doc.createdAt })}\n`);
    expect(requestIssues(JSON.parse(readFileSync(file, "utf8"))).join("; ")).toMatch(/closed/);
    const cells = judgeAll(world, ["Q1", "Q7"]);
    expect(cells.writer!.Q1!.rows).toContainEqual(expect.stringMatching(new RegExp(`queue\\.fix#${open.id}: no valid record`)));
    expect(cells.writer!.Q7!.rows.join("\n")).toMatch(new RegExp(`queue\\.fix#${open.id}:`));
    // The release gate fails closed on it too: it does not read, so it might be an open fix.
    expect(openFixes(world.root).map(finding => finding.subject)).toContain("producer/queue.fix");
  });

  it("closes a change or fix only when the requester check passes; a fail records rejected and the entry stays open", { timeout: 60_000 }, async () => {
    const world = await make();
    const open = world.raised.fix.find(item => item.target === OPEN_FIX)!;
    // Mark the requester slot needs-refresh: its checks no longer pass.
    const slotFile = join(world.consumer, "agents/writer/sections.hero.copy/slot.json");
    const slot = JSON.parse(readFileSync(slotFile, "utf8"));
    writeFileSync(slotFile, `${JSON.stringify({ ...slot, status: "needs-refresh" })}\n`);
    const refused = await runRequestCli([open.id, "--close", "--outcome", "fixed", "--result", OPEN_FIX, "--by", "writer", "--at", "2026-11-20T10:00:00Z", "--root", world.root], world.root);
    expect(refused.exitCode).toBe(1);
    expect(refused.message).toMatch(/stays open: the requester check failed .*needs-refresh/);
    const after = readRequest(world.consumer, open.id);
    expect(after.status).toBe("open");
    expect(after.events.at(-1)).toMatchObject({ op: "rejected", by: "producer" });
    expect(requestIssues(after)).toEqual([]);
    // Back to live: the close passes the check and links back to the requester.
    writeFileSync(slotFile, `${JSON.stringify(slot)}\n`);
    const closed = closeWork(world.consumer, open.id, { by: "writer", at: "2026-11-20T10:05:00Z", outcome: "fixed", result: OPEN_FIX });
    expect(closed).toMatchObject({ status: "closed", outcome: "fixed", notified: { to: "owner" } });
    expect(closed.events.map(event => event.op).slice(-2)).toEqual(["verified", "closed"]);
    expect(openFixes(world.root)).toEqual([]);
  });

  it("re-judges a pin whose verdict is stale: a pinned candidate that no longer certifies keeps the entry open", { timeout: 60_000 }, async () => {
    const world = await make();
    const open = world.raised.fix.find(item => item.target === OPEN_FIX)!;
    const card = join(world.root, ".clossys/checks/writer/sections.hero.copy/scorecard.json");
    const doc = JSON.parse(readFileSync(card, "utf8")) as { candidates: { pinSet: string }[] };
    writeFileSync(card, `${JSON.stringify({ ...doc, candidates: doc.candidates.map(row => ({ ...row, pinSet: "0".repeat(64) })) })}\n`);
    expect(() => closeWork(world.consumer, open.id, { by: "writer", at: "2026-11-20T10:00:00Z", outcome: "fixed", result: OPEN_FIX })).toThrow(/requester check failed .*does not certify on the pinSet now/);
    expect(readRequest(world.consumer, open.id)).toMatchObject({ status: "open" });
    expect(openFixes(world.root).map(finding => finding.subject)).toEqual([OPEN_FIX]);
  });

  it("refuses a change or fix close without its outcome and result, or with an unknown outcome", { timeout: 60_000 }, async () => {
    const world = await make();
    const open = world.raised.fix.find(item => item.target === OPEN_FIX)!;
    await expect(runRequestCli([open.id, "--close", "--root", world.root], world.root)).rejects.toThrow(/closes with --outcome and --result/);
    await expect(runRequestCli([open.id, "--close", "--outcome", "done", "--result", OPEN_FIX, "--root", world.root], world.root)).rejects.toThrow(/--outcome must be one of/);
    const slot = world.raised.slot[0]!;
    await expect(runRequestCli([slot.id, "--close", "--outcome", "fixed", "--result", OPEN_FIX, "--root", world.root], world.root)).rejects.toThrow(/a slot entry closes by its decision/);
  });
});
