/**
 * The request lens (foundry-build-0048 U7) on disk: requests-model.ts reads real queue entries, run ledgers, adapters
 * and the routing table of a scratch consumer and repo, and each Q row turns red on the spec's mutation.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { closeWork, raiseWork } from "../records/request.js";
import { ASSERTIONS } from "./assertions.js";
import type { AgentModel, ConformModel } from "./model.js";
import { localStores, printedGapCodes, readAgentRequests, readRequestMachinery, resetRequestFacts, seatGuardIssues } from "./requests-model.js";
import { requestsWorld } from "./__fixtures__/requests-world.js";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const FIXTURE = join(REPO, "packages/producer/test-fixtures/consumer");
const HASHED = new Set(Object.keys((JSON.parse(readFileSync(join(REPO, "packages/producer/src/constitution/skill-hashes.json"), "utf8")) as { skills: Record<string, unknown> }).skills));
const AT = "2026-11-17T10:00:00Z";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); resetRequestFacts(); });

const scratch = (prefix: string) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(root);
  return root;
};
function consumer(): string {
  const root = scratch("requests-consumer-");
  cpSync(FIXTURE, root, { recursive: true });
  return join(root, "clossys");
}
/** A scratch repo of symlinks to the real packages, with the routing table or one adapter replaced. */
function repo(change: { routing?: (doc: { rows: Record<string, unknown>[] }) => void; adapter?: { agent: string; edit: (doc: Record<string, any>) => void } } = {}): string {
  if (!change.routing && !change.adapter) return REPO;
  const root = scratch("requests-repo-");
  mkdirSync(join(root, "packages"), { recursive: true });
  for (const agent of ["director", "designer", "writer", "publisher"]) {
    if (change.adapter?.agent !== agent) { symlinkSync(join(REPO, "packages", agent), join(root, "packages", agent)); continue; }
    mkdirSync(join(root, "packages", agent), { recursive: true });
    symlinkSync(join(REPO, "packages", agent, "actions"), join(root, "packages", agent, "actions"));
    const doc = JSON.parse(readFileSync(join(REPO, "packages", agent, "conform.json"), "utf8"));
    change.adapter.edit(doc);
    writeFileSync(join(root, "packages", agent, "conform.json"), JSON.stringify(doc));
  }
  mkdirSync(join(root, "packages/producer/src/queue"), { recursive: true });
  mkdirSync(join(root, "packages/producer/src/pipeline"), { recursive: true });
  symlinkSync(join(REPO, "packages/producer/loops"), join(root, "packages/producer/loops"));
  symlinkSync(join(REPO, "packages/producer/src/pipeline/interview.ts"), join(root, "packages/producer/src/pipeline/interview.ts"));
  const table = JSON.parse(readFileSync(join(REPO, "packages/producer/src/queue/routing.json"), "utf8"));
  change.routing?.(table);
  writeFileSync(join(root, "packages/producer/src/queue/routing.json"), JSON.stringify(table));
  return root;
}
/** One agent's Q cells read from disk: the real reader, the real assertion. */
function judge(id: string, agent: string, at: { consumer: string; repo?: string }) {
  resetRequestFacts();
  const repoDir = at.repo ?? REPO;
  const requests = readRequestMachinery(repoDir, at.consumer);
  const loops = new Map(["slot", "create"].map(loop => [`loop.${loop}`, { steps: [{ decider: { by: "agent", agent: "<owner of slot>" } }] }]));
  const model = { repo: repoDir, consumer: at.consumer, machinery: { requests, loops } } as unknown as ConformModel;
  const subject = { agent, edges: [{ from: "x.y", to: "designer/sections.hero", scope: "placed" }, { from: "x.y", to: "director/focus.segment.core", scope: "placed" }, { from: "x.y", to: "page.home", target: "publisher", scope: "package" }], requestFacts: readAgentRequests(repoDir, at.consumer, agent, HASHED) } as unknown as AgentModel;
  return ASSERTIONS[id]!(subject, model);
}
const fix = (dir: string, target = "designer/sections.hero", at: string = AT) => raiseWork(dir, {
  kind: "fix", target, from: "owner", why: "the hero overflows at 320px", source: "check", by: "producer", at,
  check: "pins.resolve", findings: ["designer/sections.hero does not resolve"], cause: "the hero has no pin",
}).request;
function run(dir: string, id: string, doc: { status: string; createdAt?: string; refs?: unknown[]; steps?: unknown[]; loop?: string }) {
  const folder = join(dir, "agents/producer/ledger.create/entries");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `${id}.json`), JSON.stringify({ schema: "clossys.ledger-entry/1", id, loop: doc.loop ?? "loop.create", createdAt: doc.createdAt ?? "2026-11-17T11:00:00Z", status: doc.status, refs: doc.refs ?? [], steps: doc.steps ?? [] }));
}
const answering = (record: string) => [{ to: "producer/queue.fix", record, rel: "answers" }];

describe("the request lens on disk", () => {
  it("Q8: a done run that leaves its entry open is red; closing it with its result makes Q7 and Q8 green", { timeout: 60_000 }, async () => {
    const dir = consumer();
    const entry = fix(dir);
    expect(judge("Q8", "designer", { consumer: dir }).rows).toEqual([]);
    run(dir, "20261117T1100Z-create-hero", { status: "done", refs: answering(entry.id) });
    expect(judge("Q8", "designer", { consumer: dir }).rows).toEqual([expect.stringMatching(/is done and the entry is still open/)]);
    // The fixture hero does not resolve, so its own check (pins.resolve) refuses the close; on the request world it resolves.
    expect(() => closeWork(dir, entry.id, { by: "designer", at: "2026-11-17T11:05:00Z", outcome: "fixed", result: "designer/sections.hero" })).toThrow(/stays open: its check pins\.resolve still fails on designer\/sections\.hero/);
    const world = await requestsWorld();
    roots.push(world.root);
    // Raised after the world's own loop.create runs, so only the run below can answer or pass it over.
    const again = fix(world.consumer, "designer/sections.hero", "2026-11-20T10:30:00Z");
    run(world.consumer, "20261120T1100Z-create-hero", { status: "done", createdAt: "2026-11-20T11:00:00Z", refs: answering(again.id) });
    expect(judge("Q8", "designer", { consumer: world.consumer }).rows).toEqual([expect.stringMatching(new RegExp(`${again.id}: run .* is done and the entry is still open`))]);
    closeWork(world.consumer, again.id, { by: "designer", at: "2026-11-20T11:05:00Z", outcome: "fixed", result: "designer/sections.hero" });
    expect(judge("Q8", "designer", { consumer: world.consumer })).toMatchObject({ rows: [] });
    const q7 = judge("Q7", "designer", { consumer: world.consumer });
    expect(q7.rows).toEqual([]);
    expect(q7.evidence).toBeGreaterThan(1);
  });

  it("Q9: every pin-writing verb and writer, driven with a seat that may not act, refuses and writes nothing", { timeout: 60_000 }, () => {
    expect(seatGuardIssues(REPO)).toEqual([]);
    // A CLI that lets every verb through (exit 0): each verb probe is red. The writers are the real ones: still green.
    const root = scratch("requests-seat-");
    writeFileSync(join(root, "main.js"), "export async function runCli() { return { exitCode: 0, message: 'done' }; }\n");
    writeFileSync(join(root, "index.js"), "");
    const open = seatGuardIssues(REPO, join(root, "index.js"));
    expect(open.length).toBe(12);
    for (const row of open) expect(row).toMatch(/^clossys (pick|verdict|reissue|pin) .* exits 0: a seat acted on a slot it may not/);
    // A CLI that refuses for another reason, and one that refuses by the seat rule but writes first: both red.
    writeFileSync(join(root, "main.js"), "export async function runCli() { return { exitCode: 1, message: 'pick refused: unknown slot' }; }\n");
    expect(seatGuardIssues(REPO, join(root, "index.js"))).toContainEqual(expect.stringMatching(/is refused, but not by the seat rule \(pick refused: unknown slot\)/));
    writeFileSync(join(root, "main.js"), "import { writeFileSync } from 'node:fs'; import { join } from 'node:path';\nexport async function runCli(argv, cwd) { writeFileSync(join(cwd, 'clossys/agents/designer/components.button/pin.json'), '{}'); return { exitCode: 1, message: 'pick refused: an agent acts only on its own slots' }; }\n");
    expect(seatGuardIssues(REPO, join(root, "index.js"))).toContainEqual(expect.stringMatching(/wrote agents\/designer\/components\.button\/pin\.json/));
    expect(seatGuardIssues(REPO, join(root, "missing.js"))).toEqual([expect.stringMatching(/no built clossys CLI/)]);
  });

  it("Q1 and Q7: an invalid entry is red, never dropped from the lens", () => {
    const dir = consumer();
    const change = raiseWork(dir, { kind: "change", target: "writer/narratives.article", from: "owner", why: "tighten the intro", want: "candidate", source: "cli", by: "owner", at: AT }).request;
    const file = join(dir, "agents/producer/queue.change/entries", `${change.id}.json`);
    const { want: _want, ...noWant } = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify(noWant));
    expect(judge("Q1", "writer", { consumer: dir }).rows).toContainEqual(expect.stringMatching(new RegExp(`queue\\.change#${change.id}: no valid record .*want`)));
    // Forged closed: status closed, closing fields, `closed` pointing at the raise.
    writeFileSync(file, JSON.stringify({ ...noWant, want: "candidate", status: "closed", closed: noWant.opened, outcome: "changed", result: "writer/narratives.article", notified: { to: "owner", at: AT }, closedAt: AT }));
    expect(judge("Q7", "writer", { consumer: dir }).rows.join("\n")).toMatch(new RegExp(`queue\\.change#${change.id}: .*the status is closed and the event log has no closed event`));
  });

  it("Q3: a closed entry keeps the route it was given; only open entries are re-derived against today's table", { timeout: 60_000 }, async () => {
    const world = await requestsWorld();
    roots.push(world.root);
    expect(judge("Q3", "designer", { consumer: world.consumer }).rows).toEqual([]);
    // Any edit of the table bytes changes its sha: closed history stays green, the open entries go red.
    const at = repo({ routing: doc => { (doc as Record<string, unknown>).about = `${String((doc as Record<string, unknown>).about)} (edited)`; } });
    const closed = [...world.raised.change, ...world.raised.fix.filter(item => item.target !== "writer/sections.hero.copy")].map(item => item.id);
    const open = world.raised.fix.find(item => item.target === "writer/sections.hero.copy")!;
    for (const agent of ["director", "designer", "writer", "publisher"]) {
      const rows = judge("Q3", agent, { consumer: world.consumer, repo: at }).rows;
      for (const id of closed) expect(rows.join("\n"), `${agent} ${id}`).not.toContain(id);
      expect(rows.length, agent).toBeGreaterThan(0);
      for (const row of rows) expect(row, agent).toMatch(/another routing\.json/);
    }
    expect(judge("Q3", "writer", { consumer: world.consumer, repo: at }).rows).toContainEqual(expect.stringMatching(new RegExp(`queue\\.fix#${open.id}: .*another routing\\.json`)));
  });

  it("Q8: a stopped run with no entry re-asking it, and a run of the handler's loop that passed it over, are red", () => {
    const dir = consumer();
    const entry = fix(dir);
    run(dir, "20261117T1100Z-create-hero", { status: "stopped", refs: answering(entry.id) });
    run(dir, "20261117T1200Z-create-other", { status: "done", createdAt: "2026-11-17T12:00:00Z", steps: [{ id: "create", decider: { by: "agent", agent: "designer" }, wrote: [{ file: "designer/sections.cta/candidates/cta-v2.md", sha256: null }] }] });
    const rows = judge("Q8", "designer", { consumer: dir }).rows;
    expect(rows).toContainEqual(expect.stringMatching(/stopped and no open entry re-asks it/));
    expect(rows).toContainEqual(expect.stringMatching(/ran for designer after it was raised and passed it over/));
  });

  it("Q9: a Writer step that writes a Designer candidate is red; its own folder is green", { timeout: 60_000 }, () => {
    const dir = consumer();
    const step = (file: string) => ({ id: "create", decider: { by: "agent", agent: "writer" }, cli: "clossys submit", exit: 0, wrote: [{ file, sha256: null }] });
    run(dir, "20261117T1100Z-create-copy", { status: "done", steps: [step("writer/sections.hero.copy/candidates/hero-v2.md")] });
    // Evidence: the verb seat guard (1) and the one Writer step.
    expect(judge("Q9", "writer", { consumer: dir })).toMatchObject({ rows: [], evidence: 2 });
    run(dir, "20261117T1200Z-create-cross", { status: "done", steps: [step("designer/sections.hero/candidates/hero-v9.json")] });
    expect(judge("Q9", "writer", { consumer: dir }).rows).toEqual([expect.stringMatching(/writer wrote designer\/sections\.hero\/candidates\/hero-v9\.json, another agent's record/)]);
  });

  it("Q3: a route the table no longer gives, or one no producer routed event wrote, is red", () => {
    const dir = consumer();
    const entry = fix(dir);
    expect(judge("Q3", "designer", { consumer: dir }).rows).toEqual([]);
    const file = join(dir, "agents/producer/queue.fix/entries", `${entry.id}.json`);
    const doc = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify({ ...doc, route: { ...doc.route, table: "0".repeat(64) }, events: doc.events.filter((event: { op: string }) => event.op !== "routed") }));
    const rows = judge("Q3", "designer", { consumer: dir }).rows;
    expect(rows).toContainEqual(expect.stringMatching(/was routed by another routing\.json/));
    expect(rows).toContainEqual(expect.stringMatching(/has a route no producer routed event wrote/));
  });

  it("Q3: dropping the catch-all from routing.json is red (an unmatched entry would be dropped)", () => {
    const dir = consumer();
    const at = repo({ routing: doc => { doc.rows = doc.rows.filter(row => row.kinds !== "*"); } });
    expect(judge("Q3", "designer", { consumer: dir, repo: at }).rows).toContainEqual(expect.stringMatching(/exactly one catch-all row/));
  });

  it("Q4: copying an owner class into routing.json is red; a change on a Director slot routes to the owner packet", () => {
    const dir = consumer();
    const at = repo({ routing: doc => { doc.rows[2] = { ...doc.rows[2], when: { ia: ["director"] } }; } });
    expect(judge("Q4", "director", { consumer: dir, repo: at }).rows).toContainEqual(expect.stringMatching(/unknown key when .*owner classes are read from the loop versions/));
    raiseWork(dir, { kind: "change", target: "director/focus.segment.core", from: "writer/sections.hero.copy", want: "repin", why: "the hero copy needs the segment narrowed", source: "cli", by: "writer", at: AT });
    expect(judge("Q4", "director", { consumer: dir })).toMatchObject({ rows: [] });
    expect(judge("Q4", "director", { consumer: dir }).evidence).toBeGreaterThan(1);
  });

  it("Q5: removing requests.handling.fix from one adapter is red", () => {
    const dir = consumer();
    expect(judge("Q5", "writer", { consumer: dir }).rows.filter(row => /handling\.fix: undeclared/.test(row))).toEqual([]);
    const at = repo({ adapter: { agent: "writer", edit: doc => { delete doc.requests.handling.fix; } } });
    expect(judge("Q5", "writer", { consumer: dir, repo: at }).rows).toContainEqual("requests.handling.fix: undeclared");
  });

  it("Q6: an entry raised to an agent with no declared issuing edge is red", () => {
    const dir = consumer();
    raiseWork(dir, { kind: "change", target: "designer/sections.hero", from: "writer/sections.hero.copy", want: "candidate", why: "the hero needs room for a second line", source: "cli", by: "writer", at: AT });
    expect(judge("Q6", "writer", { consumer: dir })).toMatchObject({ rows: [] });
    const at = repo({ adapter: { agent: "writer", edit: doc => { doc.requests.issuing = doc.requests.issuing.filter((edge: { to: string }) => edge.to !== "designer"); } } });
    expect(judge("Q6", "writer", { consumer: dir, repo: at }).rows).toContainEqual(expect.stringMatching(/raised change to designer with no declared issuing edge/));
  });

  it("Q1 finds the Director and Designer request stores of their own; Q2 lists the interview gaps that only print", () => {
    expect(localStores(join(REPO, "packages/director")).rows).toContainEqual(expect.stringMatching(/^src\/format\/request\.ts: a request record id of its own/));
    expect(localStores(join(REPO, "packages/designer")).rows).toContainEqual(expect.stringMatching(/^src\/library-cli\/fs-library\.ts: a request store folder of its own/));
    expect(localStores(join(REPO, "packages/writer")).rows).toEqual([]);
    const printed = printedGapCodes(readFileSync(join(REPO, "packages/producer/src/pipeline/interview.ts"), "utf8"));
    expect(printed).toContain("request.input-unpinned");
    // SLOT-CREATE files a slotless need as a kind slot entry: it is recorded, not only printed.
    expect(printed).not.toContain("request.slot-missing");
  });

  it("Q10 lists today's queue-entry/1 fix raisers; Q11 is green with the requests.open-fix gate", () => {
    const dir = consumer();
    const requests = readRequestMachinery(REPO, dir);
    expect(requests.fixRaisers).toEqual(["packages/producer/src/loop/route.ts", "packages/producer/src/loop/runner.ts", "packages/producer/src/queue/feedback.ts"]);
    expect(requests.releaseGates).toContain("requests.open-fix");
    expect(judge("Q11", "publisher", { consumer: dir })).toMatchObject({ rows: [], evidence: 1 });
  });
});
