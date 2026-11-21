/**
 * The request lens (foundry-build-0048 U7) on disk: requests-model.ts reads real queue entries, run ledgers, adapters
 * and the routing table of a scratch consumer and repo, and each Q row turns red on the spec's mutation.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { raiseEntry } from "../loop/route.js";
import { closeWork, inputsSha256, raiseWork, requestIssues } from "../records/request.js";
import { ASSERTIONS } from "./assertions.js";
import type { AgentModel, ConformModel } from "./model.js";
import { localStores, printedGapCodes, readAgentRequests, readRequestMachinery, resetRequestFacts, seatGuardIssues } from "./requests-model.js";
import { OPEN_FIX, requestsWorld, requireMissingCopyField, staleVerdicts } from "./__fixtures__/requests-world.js";

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
  const root = scratch("requests-checkout-");
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
    expect(open.length).toBe(18);
    for (const row of open) expect(row).toMatch(/^clossys (pick|verdict|reissue|pin|retire) .* exits 0: a seat acted on a slot it may not/);
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

  it("Q1 finds no agent request store of its own (U8 moved Director and Designer onto the queue); Q2 lists the interview gaps that only print", () => {
    for (const agent of ["director", "designer", "writer", "publisher"]) expect(localStores(join(REPO, "packages", agent)).rows, agent).toEqual([]);
    const printed = printedGapCodes(readFileSync(join(REPO, "packages/producer/src/pipeline/interview.ts"), "utf8"));
    expect(printed).toContain("request.input-unpinned");
    // SLOT-CREATE files a slotless need as a kind slot entry: it is recorded, not only printed.
    expect(printed).not.toContain("request.slot-missing");
  });

  it("Q10 finds no queue-entry/1 fix raiser in Producer (U8: cascade, audit, failed steps and feedback raise queue-entry/2); Q11 is green with the requests.open-fix gate", () => {
    const dir = consumer();
    const requests = readRequestMachinery(REPO, dir);
    expect(requests.fixRaisers).toEqual([]);
    expect(requests.releaseGates).toContain("requests.open-fix");
    expect(judge("Q11", "publisher", { consumer: dir })).toMatchObject({ rows: [], evidence: 1 });
  });
});

// foundry-build-0048 U7 r3: Q7 mirrors the closure rule and binds its re-run to the judged inputs' digest; Q1, Q10
// and Q11 read the queue-entry/1 fixes through the one strict reader (queue/legacy-fix.ts).
describe("the request lens on the closure rule, the inputs digest and the strict /1 reader (U7 r3)", () => {
  const AGENTS = ["director", "designer", "writer", "publisher"] as const;
  const world = async () => {
    const made = await requestsWorld();
    roots.push(made.root);
    const open = made.raised.fix.find(item => item.target === OPEN_FIX)!;
    return { made, open, file: join(made.consumer, "agents/producer/queue.fix/entries", `${open.id}.json`) };
  };
  /** The open fix written closed by hand: a producer verified event right before a close by `by`, the digest of today's bytes. */
  const forgeClosed = (consumer: string, file: string, by: string, outcome: "fixed" | "declined") => {
    const doc = JSON.parse(readFileSync(file, "utf8"));
    const at = "2026-11-20T10:00:00Z", n = doc.events.length;
    const detail = `requester check passed on ${OPEN_FIX}${outcome === "fixed" ? `; fix check ${doc.check} passes on ${OPEN_FIX}` : ""}`;
    const events = [...doc.events,
      { id: `${doc.id}#${n + 1}`, op: "verified", by: "producer", at, detail, inputsSha256: inputsSha256(consumer, doc) },
      { id: `${doc.id}#${n + 2}`, op: "closed", by, at, detail: `${outcome}: ${OPEN_FIX}; notified owner` }];
    const closed = { ...doc, status: "closed", outcome, result: OPEN_FIX, notified: { to: "owner", at }, closedAt: at, closed: `${doc.id}#${n + 2}`, events };
    writeFileSync(file, `${JSON.stringify(closed)}\n`);
    return closed;
  };
  /** A valid clossys.queue-entry/1 queue.fix entry, raised by the production raiser, then edited by `edit`. */
  const legacyFix = (root: string, slug: string, edit: (doc: Record<string, unknown>) => Record<string, unknown> = doc => doc, name?: string) => {
    const { entry } = raiseEntry(root, { queue: "queue.fix", decider: "agent:designer", subject: { to: "designer/sections.hero" as never, rel: "input" }, ask: "the hero overflows", slug }, "2026-11-17T09:00:00Z", false);
    const dir = join(root, "clossys/agents/producer/queue.fix/entries");
    const from = join(dir, `${entry.id}.json`);
    const doc = edit(JSON.parse(readFileSync(from, "utf8")));
    writeFileSync(name ? join(dir, name) : from, `${JSON.stringify(doc)}\n`);
    if (name) rmSync(from);
    return { id: entry.id, path: `clossys/agents/producer/queue.fix/entries/${name ?? `${entry.id}.json`}` };
  };

  it("T9: Q7 is red on a fix closed declined by its assignee, with no owner answer, under valid verified provenance", { timeout: 60_000 }, async () => {
    const { made, open, file } = await world();
    const closed = forgeClosed(made.consumer, file, "writer", "declined");
    expect(requestIssues(closed, made.root).join("; ")).toMatch(/the close by writer: the assignee closes a fix only as fixed/);
    const rows = judge("Q7", "writer", { consumer: made.consumer }).rows;
    expect(rows).toContainEqual(expect.stringMatching(new RegExp(`^queue\\.fix#${open.id}: closed, and its close by writer breaks the closure rule: the assignee closes a fix only as fixed`)));
  });

  it("T9b: the same fixed close by its assignee breaks no closure rule", { timeout: 60_000 }, async () => {
    const { made, file } = await world();
    forgeClosed(made.consumer, file, "writer", "fixed");
    expect(judge("Q7", "writer", { consumer: made.consumer }).rows).toEqual([]);
  });

  it("T11 (Q1): a hidden .x.json queue.fix file is red in Q1 for all four agents and refused by the gate by name", { timeout: 60_000 }, async () => {
    const { made } = await world();
    const hidden = legacyFix(made.root, "hidden-hero", doc => doc, ".x.json");
    for (const agent of AGENTS) {
      expect(judge("Q1", agent, { consumer: made.consumer }).rows, agent).toContainEqual(expect.stringMatching(/: no valid record \(\.x\.json is a hidden file/));
    }
    expect(judge("Q11", "designer", { consumer: made.consumer }).rows).toEqual([]);
    expect(readRequestMachinery(REPO, made.consumer).openFix.unread).toContain(hidden.path);
  });

  it("T12: a /1 fix with no subject is red in Q1 for all four agents and counted by Q11 as unread", { timeout: 60_000 }, async () => {
    const { made } = await world();
    const bare = legacyFix(made.root, "no-subject", ({ subject: _subject, ...doc }) => doc);
    for (const agent of AGENTS) {
      expect(judge("Q1", agent, { consumer: made.consumer }).rows, agent).toContainEqual(expect.stringMatching(new RegExp(`^queue\\.fix#${bare.id}: no valid record \\(.*no subject`)));
      const q11 = judge("Q11", agent, { consumer: made.consumer });
      expect(q11.rows, agent).toEqual([]);
      expect(q11.evidence, agent).toBeGreaterThanOrEqual(2);
    }
    expect(readRequestMachinery(REPO, made.consumer).openFix.unread).toContain(bare.path);
  });

  it("T13: an honest close then a pin bump (drift) leaves Q7 green; a forged close over unchanged inputs whose requester check fails is red", { timeout: 90_000 }, async () => {
    const { made, open, file } = await world();
    const closed = closeWork(made.consumer, open.id, { by: "writer", at: "2026-11-20T10:05:00Z", outcome: "fixed", result: OPEN_FIX });
    expect(closed.events.find(event => event.op === "verified")?.inputsSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(judge("Q7", "writer", { consumer: made.consumer }).rows).toEqual([]);
    // The pin moves after the close: its requester check would fail now, but that is slots.stale's, not Q7's.
    const pinFile = join(made.consumer, "agents/writer/sections.hero.copy/pin.json");
    const pinBytes = readFileSync(pinFile, "utf8");
    writeFileSync(pinFile, "{ \"bumped\": true }\n");
    expect(judge("Q7", "writer", { consumer: made.consumer }).rows).toEqual([]);
    writeFileSync(pinFile, pinBytes);
    // The record's contract gains a field the pinned record lacks; its fresh verdict still stands, so nothing re-judges it.
    requireMissingCopyField(made.root);
    // A forged close over today's bytes, while the pin no longer certifies (the scorecard, not a judged input): red.
    writeFileSync(file, `${JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), status: "open" })}\n`);
    const reopened = (({ outcome: _o, result: _r, notified: _n, closedAt: _c, closed: _d, ...doc }) => ({ ...doc, events: doc.events.filter((event: { op: string }) => event.op !== "verified" && event.op !== "closed") }))(JSON.parse(readFileSync(file, "utf8")));
    writeFileSync(file, `${JSON.stringify(reopened)}\n`);
    forgeClosed(made.consumer, file, "writer", "fixed");
    expect(judge("Q7", "writer", { consumer: made.consumer }).rows).toEqual([]);
    staleVerdicts(made.root, "writer", "sections.hero.copy");
    expect(judge("Q7", "writer", { consumer: made.consumer }).rows).toContainEqual(expect.stringMatching(new RegExp(`queue\\.fix#${open.id}: closed, and the requester check fails now: .*does not certify on the pinSet now`)));
  });
});
