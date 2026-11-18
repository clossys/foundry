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
import { localStores, printedGapCodes, readAgentRequests, readRequestMachinery, resetRequestFacts } from "./requests-model.js";

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
const fix = (dir: string, target = "designer/sections.hero") => raiseWork(dir, {
  kind: "fix", target, from: "owner", why: "the hero overflows at 320px", source: "check", by: "producer", at: AT,
  check: "render.overflow", findings: ["hero heading overflows at 320px"], cause: "the heading has no wrap rule",
}).request;
function run(dir: string, id: string, doc: { status: string; createdAt?: string; refs?: unknown[]; steps?: unknown[]; loop?: string }) {
  const folder = join(dir, "agents/producer/ledger.create/entries");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `${id}.json`), JSON.stringify({ schema: "clossys.ledger-entry/1", id, loop: doc.loop ?? "loop.create", createdAt: doc.createdAt ?? "2026-11-17T11:00:00Z", status: doc.status, refs: doc.refs ?? [], steps: doc.steps ?? [] }));
}
const answering = (record: string) => [{ to: "producer/queue.fix", record, rel: "answers" }];

describe("the request lens on disk", () => {
  it("Q8: a done run that leaves its entry open is red; closing it with its result makes Q7 and Q8 green", () => {
    const dir = consumer();
    const entry = fix(dir);
    expect(judge("Q8", "designer", { consumer: dir }).rows).toEqual([]);
    run(dir, "20261117T1100Z-create-hero", { status: "done", refs: answering(entry.id) });
    expect(judge("Q8", "designer", { consumer: dir }).rows).toEqual([expect.stringMatching(/is done and the entry is still open/)]);
    closeWork(dir, entry.id, { by: "designer", at: "2026-11-17T11:05:00Z", outcome: "fixed", result: "designer/sections.hero" });
    expect(judge("Q8", "designer", { consumer: dir })).toMatchObject({ rows: [] });
    expect(judge("Q7", "designer", { consumer: dir })).toMatchObject({ rows: [], evidence: 1 });
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

  it("Q9: a Writer step that writes a Designer candidate is red; its own folder is green", () => {
    const dir = consumer();
    const step = (file: string) => ({ id: "create", decider: { by: "agent", agent: "writer" }, cli: "clossys submit", exit: 0, wrote: [{ file, sha256: null }] });
    run(dir, "20261117T1100Z-create-copy", { status: "done", steps: [step("writer/sections.hero.copy/candidates/hero-v2.md")] });
    expect(judge("Q9", "writer", { consumer: dir })).toMatchObject({ rows: [], evidence: 1 });
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
