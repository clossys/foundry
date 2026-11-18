/**
 * The request lens on its own world (conform/__fixtures__/requests-world.ts): one request of each kind about every
 * content agent, raised and closed by the production verbs, read by the real conformance model. Q3, Q4 and Q6-Q9 and
 * Q11 judge real entries here (never green by construction), and Q11 proves the release gate refuses the open fix.
 */
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runRequestCli } from "../cli/request.js";
import { answerRequest, closeWork, inputsSha256, listRequests, readRequest, requestIssues } from "../records/request.js";
import { openFixes } from "../release/gates.js";
import { ASSERTIONS } from "./assertions.js";
import type { ProbeFacts } from "./dogfood.js";
import { CONFORM_AGENTS, readConformModel } from "./model.js";
import { internalWriterIssues, seatGuardIssues } from "./requests-model.js";
import { CHANGES, FIXES, NEEDS, OPEN_FIX, requestsWorld, requireMissingCopyField, staleVerdicts, type RequestsWorld } from "./__fixtures__/requests-world.js";

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
    requireMissingCopyField(world.root);
    staleVerdicts(world.root, "writer", "sections.hero.copy");
    expect(() => closeWork(world.consumer, open.id, { by: "writer", at: "2026-11-20T10:00:00Z", outcome: "fixed", result: OPEN_FIX })).toThrow(/requester check failed .*does not certify on the pinSet now/);
    expect(readRequest(world.consumer, open.id)).toMatchObject({ status: "open" });
    expect(openFixes(world.root).map(finding => finding.subject)).toEqual([OPEN_FIX]);
  });

  it("refuses a change or fix close without its outcome and result, or with an unknown outcome", { timeout: 60_000 }, async () => {
    const world = await make();
    const open = world.raised.fix.find(item => item.target === OPEN_FIX)!;
    await expect(runRequestCli([open.id, "--close", "--root", world.root], world.root)).rejects.toThrow(/closes with --outcome and --result/);
    await expect(runRequestCli([open.id, "--close", "--outcome", "done", "--result", OPEN_FIX, "--root", world.root], world.root)).rejects.toThrow(/a fix entry closes with --outcome fixed or declined/);
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

  it("a change or fix closes only by --by its assignee or the owner's typed answer; no default closer, no other seat, never bare owner", { timeout: 60_000 }, async () => {
    const world = await make();
    const open = world.raised.fix.find(item => item.target === OPEN_FIX)!;
    const file = entryFile(world, "fix", open.id);
    await expect(runRequestCli([open.id, "--close", "--outcome", "fixed", "--result", OPEN_FIX, "--root", world.root], world.root)).rejects.toThrow(/closes with --by writer \(its assignee\); an entry the owner answers takes --answer <option>/);
    for (const by of ["producer", "planner", "designer"]) {
      expect(() => closeWork(world.consumer, open.id, { by, at: "2026-11-20T10:00:00Z", outcome: "fixed", result: OPEN_FIX }), by).toThrow(new RegExp(`${by} cannot close ${open.id}: it is assigned to writer`));
    }
    expect(() => closeWork(world.consumer, open.id, { by: "owner", at: "2026-11-20T10:00:00Z", outcome: "fixed", result: OPEN_FIX })).toThrow(/bare owner is no closer: the owner answers one of the entry's options/);
    // The entry's own answer ref closes nothing until the owner chose an option.
    expect(() => closeWork(world.consumer, open.id, { by: `owner:queue.fix#${open.id}`, at: "2026-11-20T10:00:00Z", outcome: "declined", result: `queue.fix#${open.id}` })).toThrow(/closes it only right after the owner's answer chose one of its options/);
    // With no question open, an answer is refused and writes nothing.
    const before = readFileSync(file, "utf8");
    expect(await runRequestCli([open.id, "--answer", "decline", "--by", "owner", "--root", world.root], world.root)).toMatchObject({ exitCode: 1, message: expect.stringMatching(/awaits no owner answer \(assigned to writer, no options\); nothing was written/) });
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(readRequest(world.consumer, open.id)).toMatchObject({ status: "open" });
  });

  it("an agent's declined fix claim asks the owner a closed question; only an offered option id is recorded, and it runs its step", { timeout: 60_000 }, async () => {
    const world = await make();
    const open = world.raised.fix.find(item => item.target === OPEN_FIX)!;
    const file = entryFile(world, "fix", open.id);
    // The claim stays open with Producer's options; the assignee cannot close it again while the owner is asked.
    const asked = await runRequestCli([open.id, "--close", "--outcome", "declined", "--result", `queue.fix#${open.id}`, "--by", "writer", "--at", "2026-11-20T10:00:00Z", "--root", world.root], world.root);
    expect(asked.message).toMatch(/stays open; Producer asked the owner about writer's declined claim/);
    expect(readRequest(world.consumer, open.id)).toMatchObject({ status: "open", options: [{ id: "decline", then: { verb: "close", args: ["declined"] } }, { id: "keep-open", then: { verb: "reject", args: [] } }] });
    expect(readRequest(world.consumer, open.id).events.at(-1)).toMatchObject({ op: "asked", by: "producer" });
    expect(() => closeWork(world.consumer, open.id, { by: "writer", at: "2026-11-20T10:01:00Z", outcome: "fixed", result: OPEN_FIX })).toThrow(/awaits the owner's answer \(decline, keep-open\)/);
    // An option id the entry does not offer is refused and nothing is written; so is free text.
    const before = readFileSync(file, "utf8");
    for (const answer of ["fixed", "fixed: the pin resolves", "approve"]) {
      expect(await runRequestCli([open.id, "--answer", answer, "--by", "owner", "--root", world.root], world.root), answer).toMatchObject({ exitCode: 1, message: expect.stringMatching(/is none of request .*'s options \(decline, keep-open\); nothing was written/) });
      expect(readFileSync(file, "utf8"), answer).toBe(before);
    }
    await expect(runRequestCli([open.id, "--answer", "decline", "--by", "writer", "--root", world.root], world.root)).rejects.toThrow(/--answer is the owner's; it takes no --by writer/);
    expect(readFileSync(file, "utf8")).toBe(before);
    // keep-open: recorded, a rejected event, still open with writer; the question is closed so the assignee may work on.
    const kept = await runRequestCli([open.id, "--answer", "keep-open", "--note", "not yet", "--at", "2026-11-20T10:02:00Z", "--root", world.root], world.root);
    expect(kept.exitCode).toBe(0);
    const keptEntry = readRequest(world.consumer, open.id);
    expect(keptEntry).toMatchObject({ status: "open", assignee: "writer" });
    expect(keptEntry.events.slice(-2)).toMatchObject([{ op: "answered", by: "owner", option: "keep-open", detail: "not yet" }, { op: "rejected", by: "producer" }]);
    expect(requestIssues(keptEntry, world.root)).toEqual([]);
    // Asked again, decline closes it declined by the entry's own answer ref, linking back to the requester.
    await runRequestCli([open.id, "--close", "--outcome", "declined", "--result", `queue.fix#${open.id}`, "--by", "writer", "--at", "2026-11-20T10:03:00Z", "--root", world.root], world.root);
    const declined = await runRequestCli([open.id, "--answer", "decline", "--at", "2026-11-20T10:04:00Z", "--root", world.root], world.root);
    expect(declined.exitCode).toBe(0);
    const closed = readRequest(world.consumer, open.id);
    expect(closed).toMatchObject({ status: "closed", outcome: "declined", result: `queue.fix#${open.id}`, notified: { to: open.from } });
    expect(closed.events.find(event => event.op === "closed")).toMatchObject({ by: `owner:queue.fix#${open.id}` });
    expect(requestIssues(closed, world.root)).toEqual([]);
  });

  it("a fix closing as fixed re-runs its own check: still failing, it records rejected and stays open; a check it cannot re-run asks the owner", { timeout: 60_000 }, async () => {
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
    // A check Producer cannot re-run never closes fixed: the claim asks the owner (decline or keep-open, never fixed).
    recheck("render.overflow");
    const claimed = closeWork(world.consumer, open.id, { by: "writer", at: "2026-11-20T10:02:00Z", outcome: "fixed", result: OPEN_FIX });
    expect(claimed).toMatchObject({ asked: true, status: "open", options: [{ id: "decline" }, { id: "keep-open" }] });
    expect(claimed.events.at(-1)).toMatchObject({ op: "asked", by: "producer", detail: expect.stringMatching(/check render\.overflow, which Producer cannot re-run/) });
    expect((await answerRequest(world.consumer, open.id, { option: "keep-open", at: "2026-11-20T10:03:00Z" })).request).toMatchObject({ status: "open" });
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
      // The forger computes the digest over today's bytes, as closeWork would (U7 r3): only then does Q7 re-run it.
      const events = [...doc.events, { id: `${open.id}#${n + 1}`, op: "verified", by: "producer", at, detail: `requester check passed on ${OPEN_FIX}; fix check pins.resolve passes on ${OPEN_FIX}`, inputsSha256: inputsSha256(world.consumer, doc), ...verified }, ...extra.map((event, index) => ({ id: `${open.id}#${n + 2 + index}`, at, ...event }))];
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
    // The slot changed after the forged close: drift, slots.stale's (no red, U7 r3). Forged over today's bytes: red.
    expect(judgeAll(world, ["Q7"]).writer!.Q7!.rows).toEqual([]);
    writeFileSync(file, `${JSON.stringify(forge({}))}\n`);
    expect(judgeAll(world, ["Q7"]).writer!.Q7!.rows).toContainEqual(expect.stringMatching(new RegExp(`queue\\.fix#${open.id}: closed, and the requester check fails now: .*needs-refresh`)));
    // A forged fixed close whose own check fails now is red too.
    writeFileSync(slotFile, `${JSON.stringify({ ...slot, refs: [...(slot.refs ?? []), { to: "writer/sections.nowhere", rel: "input" }] })}\n`);
    const dangling = forge({});
    writeFileSync(file, `${JSON.stringify({ ...dangling, check: "refs.dangling", events: dangling.events.map((event: { op: string; detail?: string }) => event.op === "verified" ? { ...event, detail: `requester check passed on ${OPEN_FIX}; fix check refs.dangling passes on ${OPEN_FIX}` } : event) })}\n`);
    expect(judgeAll(world, ["Q7"]).writer!.Q7!.rows).toContainEqual(expect.stringMatching(new RegExp(`queue\\.fix#${open.id}: closed, and its check refs\\.dangling fails now: .*sections\\.nowhere`)));
  });
});

describe("Q9: the retire verb through the built CLI (foundry-build-0048 U7 r3)", () => {
  it("T4: Q9 is red when retire lets a foreign seat, bare owner or the planner through, and green on the real dist", { timeout: 120_000 }, () => {
    // The real built CLI: every retire probe is refused by the actor guard and writes nothing.
    expect(seatGuardIssues(REPO)).toEqual([]);
    // A CLI whose retire has no guard (every other verb refuses by the seat rule): Q9 names each retire probe.
    const root = realpathSync(mkdtempSync(join(tmpdir(), "requests-retire-")));
    try {
      writeFileSync(join(root, "main.js"), "export async function runCli(argv) { return argv[0] === 'retire' ? { exitCode: 0, message: 'retire: done' } : { exitCode: 1, message: argv[0] + ' refused: an agent acts only on its own slots' }; }\n");
      writeFileSync(join(root, "index.js"), "");
      const rows = seatGuardIssues(REPO, join(root, "index.js"));
      const retire = rows.filter(row => row.startsWith("clossys retire"));
      expect(retire.sort()).toEqual([
        "retire --slot --by agent:writer", "retire --slot --by owner",
        "retire <candidate> --by agent:judge", "retire <candidate> --by agent:writer", "retire <candidate> --by owner", "retire <candidate> --by planner",
      ].map(verb => `clossys ${verb} on designer/<slot> exits 0: a seat acted on a slot it may not (retire: done)`).sort());
      expect(rows.filter(row => !row.startsWith("clossys retire"))).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("Q9 is red when a file outside the listed callers reaches a Producer-internal writer", () => {
    const src = join(REPO, "packages/producer/src");
    expect(internalWriterIssues(src)).toEqual([]);
    const root = realpathSync(mkdtempSync(join(tmpdir(), "requests-internal-")));
    try {
      writeFileSync(join(root, "rogue.ts"), "appendSlotDocEvent(consumer, agent, id, { by: flags.by });\n");
      expect(internalWriterIssues(root)).toEqual(["rogue.ts calls the Producer-internal writer appendSlotDocEvent (no actor guard); judge the actor first or list it in PRODUCER_INTERNAL_WRITERS"]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
