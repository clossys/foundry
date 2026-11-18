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
  it("B2: an invalid entry naming no content agent is red in Q1 for all four; a queue.fix file with no schema is red in Q1 and counted by Q11", { timeout: 90_000 }, async () => {
    const world = await make();
    const change = world.raised.change[0]!;
    const changeFile = entryFile(world, "change", change.id);
    const doc = JSON.parse(readFileSync(changeFile, "utf8"));
    writeFileSync(changeFile, `${JSON.stringify({ ...doc, from: "owner", assignee: "owner", target: "nowhere" })}\n`);
    const open = world.raised.fix.find(item => item.target === OPEN_FIX)!;
    const fixFile = entryFile(world, "fix", open.id);
    const { schema: _schema, ...noSchema } = JSON.parse(readFileSync(fixFile, "utf8"));
    writeFileSync(fixFile, `${JSON.stringify(noSchema)}\n`);
    const model = readConformModel(REPO, world.consumer);
    for (const agent of model.agents) {
      const rows = ASSERTIONS.Q1!(agent, model, {} as ProbeFacts).rows;
      expect(rows, agent.agent).toContainEqual(expect.stringMatching(new RegExp(`queue\\.change#${change.id}: no valid record`)));
    }
    const writer = model.agents.find(agent => agent.agent === "writer")!;
    expect(ASSERTIONS.Q1!(writer, model, {} as ProbeFacts).rows).toContainEqual(expect.stringMatching(new RegExp(`queue\\.fix#${open.id}: no valid record .*schema`)));
    // The gate refuses the unread fix file by name: Q11 counts it and stays green.
    expect(openFixes(world.root)).toContainEqual(expect.objectContaining({ subject: "producer/queue.fix", detail: expect.stringContaining(`${open.id}.json does not read`) }));
    expect(ASSERTIONS.Q11!(writer, model, {} as ProbeFacts)).toMatchObject({ rows: [], evidence: 2 });
    // A gate that passes over an unread fix file is red.
    const requests = model.machinery.requests;
    const blind = { ...model, machinery: { ...model.machinery, requests: { ...requests, openFix: { ...requests.openFix, unread: new Set<string>() } } } };
    expect(ASSERTIONS.Q11!(writer, blind, {} as ProbeFacts).rows).toEqual([expect.stringMatching(new RegExp(`queue\\.fix/entries/${open.id}\\.json: does not read and requests\\.open-fix does not refuse it`))]);
  });

  it("a change or fix closes only by --by its assignee or the owner; no default closer, no other seat", { timeout: 60_000 }, async () => {
    const world = await make();
    const open = world.raised.fix.find(item => item.target === OPEN_FIX)!;
    await expect(runRequestCli([open.id, "--close", "--outcome", "fixed", "--result", OPEN_FIX, "--root", world.root], world.root)).rejects.toThrow(/closes with --by writer \(its assignee\) or --by owner/);
    for (const by of ["producer", "planner", "designer"]) {
      expect(() => closeWork(world.consumer, open.id, { by, at: "2026-11-20T10:00:00Z", outcome: "fixed", result: OPEN_FIX }), by).toThrow(new RegExp(`${by} cannot close ${open.id}: it is assigned to writer`));
    }
    expect(readRequest(world.consumer, open.id)).toMatchObject({ status: "open" });
    expect(closeWork(world.consumer, open.id, { by: "owner", at: "2026-11-20T10:05:00Z", outcome: "fixed", result: OPEN_FIX })).toMatchObject({ status: "closed", events: expect.arrayContaining([expect.objectContaining({ op: "closed", by: "owner" })]) });
  });

  it("a fix closing as fixed re-runs its own check: still failing, it records rejected and stays open; an unknown check refuses", { timeout: 60_000 }, async () => {
    const world = await make();
    const open = world.raised.fix.find(item => item.target === OPEN_FIX)!;
    const file = entryFile(world, "fix", open.id);
    const slotFile = join(world.consumer, "agents/writer/sections.hero.copy/slot.json");
    const slotBytes = readFileSync(slotFile, "utf8");
    const slot = JSON.parse(slotBytes);
    const recheck = (check: string) => writeFileSync(file, `${JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), check })}\n`);
    // refs.dangling: a dangling ref in the slot's slot.json fails it; the fix check runs first and records rejected.
    recheck("refs.dangling");
    writeFileSync(slotFile, `${JSON.stringify({ ...slot, refs: [...(slot.refs ?? []), { to: "writer/sections.nowhere", rel: "input" }] })}\n`);
    expect(() => closeWork(world.consumer, open.id, { by: "writer", at: "2026-11-20T10:00:00Z", outcome: "fixed", result: OPEN_FIX })).toThrow(/stays open: its check refs\.dangling still fails on writer\/sections\.hero\.copy .*sections\.nowhere/);
    expect(readRequest(world.consumer, open.id)).toMatchObject({ status: "open", events: expect.arrayContaining([expect.objectContaining({ op: "rejected", by: "producer", detail: expect.stringMatching(/^fix check refs\.dangling still fails/) })]) });
    writeFileSync(slotFile, slotBytes);
    // pins.resolve (the fix's own check): an unreadable pin fails it; the same pin back, it passes and the close goes through.
    recheck("pins.resolve");
    const pinFile = join(world.consumer, "agents/writer/sections.hero.copy/pin.json");
    const pinBytes = readFileSync(pinFile, "utf8");
    writeFileSync(pinFile, "{ not json");
    expect(() => closeWork(world.consumer, open.id, { by: "writer", at: "2026-11-20T10:01:00Z", outcome: "fixed", result: OPEN_FIX })).toThrow(/stays open: its check pins\.resolve still fails on writer\/sections\.hero\.copy/);
    expect(readRequest(world.consumer, open.id).events.at(-1)).toMatchObject({ op: "rejected", by: "producer" });
    writeFileSync(pinFile, pinBytes);
    // A check Producer cannot re-run never closes fixed, and nothing is written.
    recheck("render.overflow");
    const unknown = readFileSync(file, "utf8");
    expect(() => closeWork(world.consumer, open.id, { by: "writer", at: "2026-11-20T10:02:00Z", outcome: "fixed", result: OPEN_FIX })).toThrow(/cannot close fixed: its check render\.overflow is not one Producer can re-run/);
    expect(readFileSync(file, "utf8")).toBe(unknown);
    recheck("pins.resolve");
    const closed = closeWork(world.consumer, open.id, { by: "writer", at: "2026-11-20T10:05:00Z", outcome: "fixed", result: OPEN_FIX });
    expect(closed.events.at(-2)).toMatchObject({ op: "verified", by: "producer", detail: `requester check passed on ${OPEN_FIX}; fix check pins.resolve passes on ${OPEN_FIX}` });
    expect(requestIssues(closed)).toEqual([]);
  });

  it("a forged verified event fails: out of place or wrong in requestIssues, and re-checked by Q7 when it looks right", { timeout: 90_000 }, async () => {
    const world = await make();
    const open = world.raised.fix.find(item => item.target === OPEN_FIX)!;
    const file = entryFile(world, "fix", open.id);
    const doc = JSON.parse(readFileSync(file, "utf8"));
    const at = "2026-11-20T10:00:00Z";
    const n = doc.events.length;
    const forge = (verified: Record<string, unknown>, extra: Record<string, unknown>[] = []) => {
      const events = [...doc.events, { id: `${open.id}#${n + 1}`, op: "verified", by: "producer", at, detail: `requester check passed on ${OPEN_FIX}; fix check pins.resolve passes on ${OPEN_FIX}`, ...verified }, ...extra.map((event, index) => ({ id: `${open.id}#${n + 2 + index}`, at, ...event }))];
      const closedId = `${open.id}#${events.length + 1}`;
      return { ...doc, status: "closed", outcome: "fixed", result: OPEN_FIX, notified: { to: "owner", at }, closedAt: at, closed: closedId, events: [...events, { id: closedId, op: "closed", by: "writer", at, detail: `fixed: ${OPEN_FIX}; notified owner` }] };
    };
    expect(requestIssues(forge({ by: "writer" })).join("; ")).toMatch(/no producer verified event .*before its close/);
    // An earlier producer verified event does not back a close that a seat's own "verified" sits right before.
    expect(requestIssues(forge({}, [{ op: "verified", by: "writer", detail: `requester check passed on ${OPEN_FIX}; fix check pins.resolve passes on ${OPEN_FIX}` }])).join("; ")).toMatch(/not Producer's verified event/);
    expect(requestIssues(forge({}, [{ op: "rejected", by: "producer" }])).join("; ")).toMatch(/not Producer's verified event/);
    expect(requestIssues(forge({ at: "2026-11-20T09:00:00Z" })).join("; ")).toMatch(/not the close's .*the requester check runs in the close/);
    expect(requestIssues(forge({ detail: "requester check passed" })).join("; ")).toMatch(/it names the slots the requester check judges/);
    // A forgery with every field right reads, so Q7 re-runs what it claims: the requester slot is needs-refresh, red.
    const good = forge({});
    expect(requestIssues(good)).toEqual([]);
    writeFileSync(file, `${JSON.stringify(good)}\n`);
    expect(judgeAll(world, ["Q7"]).writer!.Q7!.rows).toEqual([]);
    const slotFile = join(world.consumer, "agents/writer/sections.hero.copy/slot.json");
    const slot = JSON.parse(readFileSync(slotFile, "utf8"));
    writeFileSync(slotFile, `${JSON.stringify({ ...slot, status: "needs-refresh" })}\n`);
    expect(judgeAll(world, ["Q7"]).writer!.Q7!.rows).toContainEqual(expect.stringMatching(new RegExp(`queue\\.fix#${open.id}: closed, and the requester check fails now: .*needs-refresh`)));
    // A forged fixed close whose own check fails now is red too.
    writeFileSync(slotFile, `${JSON.stringify({ ...slot, refs: [...(slot.refs ?? []), { to: "writer/sections.nowhere", rel: "input" }] })}\n`);
    writeFileSync(file, `${JSON.stringify({ ...good, check: "refs.dangling", events: good.events.map((event: { op: string; detail?: string }) => event.op === "verified" ? { ...event, detail: `requester check passed on ${OPEN_FIX}; fix check refs.dangling passes on ${OPEN_FIX}` } : event) })}\n`);
    expect(judgeAll(world, ["Q7"]).writer!.Q7!.rows).toContainEqual(expect.stringMatching(new RegExp(`queue\\.fix#${open.id}: closed, and its check refs\\.dangling fails now: .*sections\\.nowhere`)));
  });
});
