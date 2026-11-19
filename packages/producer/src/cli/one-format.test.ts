/**
 * One format (foundry-build-0048 U13): every verb that wrote clossys.slot/1 or a pin/1 now writes clossys.slot/2,
 * clossys.pin/2 (or a Writer clossys.pin-map/1 record) and a headered clossys.candidate/1 only, and refuses a
 * clossys.slot/1 slot with the migrate message, writing nothing. Run for real on temp copies of
 * `test-fixtures/consumer` (a slot/2 store whose Producer seats are still slot/1: a mixed store) and of the
 * legacy tree (slot/1 slots and pin/1 pins).
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";

// Every decision here runs the constitution guard over the whole fixture consumer (U13 r4: no guard=false), so a
// test takes seconds, not the config's 5 s default budget.
vi.setConfig({ testTimeout: 60_000 });
import { sha256Hex } from "../records/hash.js";
import { readCandidateFile } from "../records/candidate.js";
import { writeCandidate, writePin, writeSlotOptions, writeVerdict } from "../records/slot-write.js";
import { storeFormatPath } from "../records/store-format.js";
import { openPackets, PLACEHOLDER_MEANING, QUEUE_ANSWER } from "../pipeline/chain.js";
import { consumerCopy } from "../records/__fixtures__/slot2-workspace.js";
import { jsonBytes, slotPositions, type IaDoc } from "../records/slot-model/index.js";
import { applySlotsMigration, planSlotsMigration } from "../migrate/slots.js";
import { runCli } from "./main.js";
import { runPickCli } from "./options.js";
import { runApproveCli, runIaCli, runSeatCli } from "./owner.js";
import { runPinCli } from "./pin.js";
import { answerRequest, raiseWork } from "../records/request.js";
import { runGuard } from "../constitution/guard.js";
import { runReissueCli } from "./reissue.js";
import { bareEntry, ownerEntry, type OwnerEntryInput } from "./__fixtures__/owner-entry.js";
import { pinUpstream } from "./__fixtures__/upstream.js";

const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const SLOT = "sections.hero.copy";
const AT = "2026-11-18T10:00:00Z";
const LATER = "2026-11-18T11:00:00Z";
const QUEUE_ID = "20261118T1000Z-hero-copy";
const REF = "clossys/workspace#46 issuecomment-1";
const MIGRATE = /clossys\.slot\/1 slot; this verb writes clossys\.slot\/2 and clossys\.pin\/2 only: run clossys migrate slots --apply first/;
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const GOOD = `---
slot: "${SLOT}"
locales: ["en"]
reason: "realises director:advantage.proposition.promise for the hero"
source: {"kind":"derived","ref":["director:identity.verbal.voice","director:advantage.proposition.promise","director:identity.naming.name"]}
---

## en
### header.heading
<!-- {"id":"header.heading","bindings":[]} -->
Ship your site this week
### actions.primary.label
<!-- {"id":"actions.primary.label","bindings":[]} -->
Get started
`;

function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "one-format-")));
  roots.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  const consumer = join(root, "clossys");
  const dir = join(consumer, "agents", "writer", SLOT);
  return {
    root, consumer, dir,
    submit: () => writeCandidate(consumer, "writer", SLOT, "copy", GOOD, { at: AT, provenance: { by: "agent:writer", model: "claude-opus-5-5", tier: "high" } }),
    /**
     * Upstream setup for the guarded tests (B1): every slot the hero copy depends on (R02.2), the Director slot its
     * reason cites among them (R20.2), pinned as data with intact bytes. The guard judges only the Writer target.
     */
    pinUpstream: () => pinUpstream(consumer, "writer", SLOT, AT),
    /**
     * The owner's typed queue.pick answer (U13 r4, B2): a clossys.queue-entry/1 entry the owner answered, about `about`,
     * whose answered option names this candidate (a pin or approve) or is not-needed / seat about the whole slot.
     */
    queueEntry: (answer: OwnerEntryInput["answer"], about = `writer/${SLOT}`, over: Partial<OwnerEntryInput> = {}) => ownerEntry(consumer, { id: QUEUE_ID, about, answer, at: AT, ...over }),
    /** Any other bytes at the same entry path (default: an untyped `{id, kind}` object): never an owner decision. */
    bareEntry: (bytes?: string) => bareEntry(consumer, "pick", QUEUE_ID, bytes),
  };
}

const json = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

/** Every slot.json and pin.json schema in the store, by relative path (a pin/1 has no schema). */
function schemas(consumer: string): Map<string, string> {
  const out = new Map<string, string>();
  const agents = join(consumer, "agents");
  for (const agent of readdirSync(agents)) {
    if (!statSync(join(agents, agent)).isDirectory()) continue;
    for (const id of readdirSync(join(agents, agent))) {
      for (const name of ["slot.json", "pin.json"]) {
        const file = join(agents, agent, id, name);
        if (existsSync(file)) out.set(relative(consumer, file), String(json(file).schema ?? "pin/1"));
      }
    }
  }
  return out;
}

/** What a verb run changed: the slot.json and pin.json files whose schema is new or different. */
function changed(before: Map<string, string>, after: Map<string, string>): Map<string, string> {
  return new Map([...after].filter(([file, schema]) => before.get(file) !== schema || !before.has(file)));
}

/** sha256 of every file under `dir`. */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string): void => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path); else out[relative(dir, path)] = sha256Hex(readFileSync(path));
    }
  };
  walk(dir);
  return out;
}

/** The slot reads as slot/2 and its pin.json as pin/2 or a pin-map, never a pin/1; a verb that writes the candidate writes it headered. */
function expectOneFormat(dir: string, agent: "writer" | "producer" | "director", slotId: string, headered = false): Record<string, unknown> {
  expect(json(join(dir, "slot.json")).schema).toBe("clossys.slot/2");
  const pin = json(join(dir, "pin.json"));
  expect(["clossys.pin/2", "clossys.pin-map/1"]).toContain(pin.schema);
  const names = pin.schema === "clossys.pin-map/1" ? Object.values(pin.records as Record<string, { candidate: string }>).map(row => row.candidate) : [String(pin.candidate)];
  for (const name of headered ? names : []) {
    const read = readCandidateFile(join(dir, "candidates", name), { agent, slotId });
    expect(read.header, `${name} carries no clossys header`).toBeDefined();
  }
  return pin;
}

describe("each verb writes clossys.slot/2 and clossys.pin/2 only", { timeout: 120_000 }, () => {
  it("pick: an agent pick is one pin-map record with basis agent", async () => {
    const w = world();
    w.pinUpstream();
    const good = w.submit();
    const before = schemas(w.consumer);
    const result = await runPickCli([`writer/${SLOT}#copy`, good.name, "--by", "agent:writer", "--at", AT, "--root", w.root], w.root);
    expect(result.exitCode, result.message).toBe(0);
    // B4: submit wrote the candidate through the codec (headered), and the pick pinned it.
    const pin = expectOneFormat(w.dir, "writer", SLOT, true);
    expect(pin.schema).toBe("clossys.pin-map/1");
    expect((pin.records as Record<string, unknown>).copy).toMatchObject({ candidate: good.name, sha256: good.sha256, decidedBy: "agent:writer", basis: "agent" });
    expect([...changed(before, schemas(w.consumer)).values()]).toEqual(["clossys.pin-map/1"]);
  });

  it("writePin (a named pin/1 compatibility writer) refuses a clossys.slot/2 slot at its choke point", () => {
    const w = world();
    const good = w.submit();
    const before = schemas(w.consumer);
    expect(() => writePin(w.consumer, "writer", SLOT, good.name, { decidedBy: "planner", basis: "planner", at: AT })).toThrow(/is a clossys\.slot\/2 slot, pinned only through the CHOOSE gate/);
    expect(existsSync(join(w.dir, "pin.json"))).toBe(false);
    expect([...changed(before, schemas(w.consumer)).values()]).toEqual([]);
  });

  it("confirm (B5, guard on): an agent pick is a pick event; the owner's typed answer confirms it and the guard passes", async () => {
    const w = world();
    w.pinUpstream();
    const good = w.submit();
    expect((await runPickCli([`writer/${SLOT}#copy`, good.name, "--by", "agent:writer", "--at", AT, "--root", w.root], w.root)).exitCode).toBe(0);
    const picked = readFileSync(join(w.dir, "pin.json"), "utf8");
    const ledger = () => (json(join(w.dir, "ledger.json")).events ?? []) as Record<string, unknown>[];
    const confirms = () => ledger().filter(event => event.op === "confirm");
    // The pick is the slot's decision event, naming its record (R02.3 reads it per pin-map record).
    expect(ledger().filter(event => event.op === "pick")).toEqual([expect.objectContaining({ op: "pick", verb: "pick", candidate: good.name, sha256: good.sha256, decidedBy: "agent:writer", basis: "agent", record: "copy", at: AT })]);
    const confirm = (by: string[]) => runPinCli([`writer/${SLOT}#copy`, good.name, "--confirm", ...by, "--at", LATER, "--root", w.root], w.root);
    // B4: a ledger-comment ref alone names no queue answer: refused, nothing written, no confirm event.
    const bare = await confirm(["--ref", REF]);
    expect(bare.exitCode).toBe(1);
    expect(bare.message).toMatch(/^confirm refused: .*names no queue answer/);
    // A queue answer whose entry is absent is refused too.
    expect((await confirm(["--by", `owner:queue.pick#${QUEUE_ID}`])).exitCode).toBe(1);
    // N3: only a clossys.queue-entry/2 entry the owner answered confirms: an untyped entry file, or {}, is refused.
    w.bareEntry();
    const untyped = await confirm(["--by", `owner:queue.pick#${QUEUE_ID}`]);
    expect(untyped).toMatchObject({ exitCode: 1, message: expect.stringMatching(/is not a typed queue entry \(clossys\.queue-entry\/1 or \/2\)/) });
    w.bareEntry("{}");
    expect(await confirm(["--by", `owner:queue.pick#${QUEUE_ID}`])).toMatchObject({ exitCode: 1, message: expect.stringMatching(/is not a typed queue entry \(clossys\.queue-entry\/1 or \/2\)/) });
    // A typed, answered clossys.queue-entry/1 pick is a pick, not a confirmation of the agent's pick (B2).
    w.queueEntry({ candidate: good.name });
    expect(await confirm(["--by", `owner:queue.pick#${QUEUE_ID}`])).toMatchObject({ exitCode: 1, message: expect.stringMatching(/only the owner's typed answer .* confirms an agent pick/) });
    expect(readFileSync(join(w.dir, "pin.json"), "utf8")).toBe(picked);
    expect(confirms()).toEqual([]);
    // The owner's typed answer: a repin change on the slot offers the confirmation of the agent pick as an option.
    const entry = raiseWork(w.consumer, { kind: "change", target: `writer/${SLOT}`, from: "owner", want: "repin", why: "confirm the hero copy", source: "cli", by: "owner", at: AT }).request;
    const option = entry.options?.find(each => each.then.args[2] === "--confirm");
    expect(option, JSON.stringify(entry.options)).toMatchObject({ then: { verb: "pin", args: [`writer/${SLOT}#copy`, good.name, "--confirm"] } });
    // Before the owner answers, the entry authorizes nothing: it has no answered event.
    expect((await confirm(["--by", `owner:queue.change#${entry.id}`])).message).toMatch(/has no owner answer as its last event/);
    expect(confirms()).toEqual([]);
    const answered = await answerRequest(w.consumer, entry.id, { option: option!.id, at: LATER, via: "chat", quote: "Confirm it." });
    expect(answered.ok, answered.message).toBe(true);
    const pin = expectOneFormat(w.dir, "writer", SLOT);
    const row = (pin.records as Record<string, { refs?: unknown }>).copy!;
    expect(row).toMatchObject({ candidate: good.name, basis: "agent", decidedBy: "agent:writer", confirmed: { by: "owner", ref: `producer/queue.change#${entry.id}`, at: LATER } });
    expect(JSON.stringify(pin.refs ?? row.refs)).toContain(entry.id);
    expect(confirms()).toHaveLength(1);
    expect(confirms()[0]).toMatchObject({ op: "confirm", candidate: good.name, sha256: good.sha256, record: "copy" });
    expect(answered.request).toMatchObject({ status: "closed", outcome: "changed", result: `writer/${SLOT}` });
    // The pin guard judged the confirmed record and found nothing (R02.1 and R02.3 per pin-map record).
    expect(runGuard(w.consumer, "pin", [{ agent: "writer", slot: SLOT, candidate: good.name, records: [`clossys/agents/writer/${SLOT}/pin.json`] }])).toEqual([]);
    // A second confirm (the closed entry) is refused and changes nothing.
    const bytes = readFileSync(join(w.dir, "pin.json"), "utf8");
    expect((await confirm(["--by", `owner:queue.change#${entry.id}`])).exitCode).toBe(1);
    expect(readFileSync(join(w.dir, "pin.json"), "utf8")).toBe(bytes);
    expect(confirms()).toHaveLength(1);
  });

  it("re-pick: a confirmed agent pick is owner-held; a planner repin replaces it and drops the confirmation, under the CHOOSE gate", async () => {
    const w = world();
    w.pinUpstream();
    const good = w.submit();
    const next = writeCandidate(w.consumer, "writer", SLOT, "copy", GOOD.replace("Ship your site this week", "Launch your site this week"), { at: AT, provenance: { by: "agent:writer", model: "claude-opus-5-5", tier: "high" } });
    expect((await runPickCli([`writer/${SLOT}#copy`, good.name, "--by", "agent:writer", "--at", AT, "--root", w.root], w.root)).exitCode).toBe(0);
    const entry = raiseWork(w.consumer, { kind: "change", target: `writer/${SLOT}`, from: "owner", want: "repin", why: "confirm the hero copy", source: "cli", by: "owner", at: AT }).request;
    const option = entry.options!.find(each => each.then.args[2] === "--confirm")!;
    expect((await answerRequest(w.consumer, entry.id, { option: option.id, at: LATER, via: "chat", quote: "Confirm it." })).ok).toBe(true);
    const confirmed = readFileSync(join(w.dir, "pin.json"), "utf8");
    expect(confirmed).toContain("\"confirmed\"");
    // The agent cannot re-pick over the owner's confirmation.
    expect((await runPickCli([`writer/${SLOT}#copy`, next.name, "--by", "agent:writer", "--at", LATER, "--root", w.root], w.root)).exitCode).toBe(1);
    expect(readFileSync(join(w.dir, "pin.json"), "utf8")).toBe(confirmed);
    // A candidate never submitted (no passing verdict) is refused by the CHOOSE gate, for the planner and an owner bulk pin alike.
    const stray = "copy-v9.md";
    writeFileSync(join(w.dir, "candidates", stray), GOOD);
    w.queueEntry({ candidate: stray });
    for (const by of [["--by", "planner:U13"], ["--by", `owner:queue.pick#${QUEUE_ID}`, "--basis", "bulk"]]) {
      const refused = await runPinCli([`writer/${SLOT}#copy`, stray, ...by, "--at", LATER, "--root", w.root], w.root);
      expect(refused.exitCode, by.join(" ")).toBe(1);
      expect(readFileSync(join(w.dir, "pin.json"), "utf8")).toBe(confirmed);
    }
    // The planner's repin of a gated candidate replaces the record: the confirmation was of the earlier pick only.
    const repin = await runPinCli([`writer/${SLOT}#copy`, next.name, "--by", "planner:U13", "--at", LATER, "--root", w.root], w.root);
    expect(repin.exitCode, repin.message).toBe(0);
    const planner = (expectOneFormat(w.dir, "writer", SLOT).records as Record<string, Record<string, unknown>>).copy!;
    expect(planner).toMatchObject({ candidate: next.name, decidedBy: "planner:U13", basis: "planner" });
    expect(planner.confirmed).toBeUndefined();
    // An owner bulk pin replaces the planner's in turn, citing the owner's answer naming that candidate.
    w.queueEntry({ candidate: good.name });
    const bulk = await runPinCli([`writer/${SLOT}#copy`, good.name, "--by", `owner:queue.pick#${QUEUE_ID}`, "--basis", "bulk", "--at", LATER, "--root", w.root], w.root);
    expect(bulk.exitCode, bulk.message).toBe(0);
    expect((expectOneFormat(w.dir, "writer", SLOT).records as Record<string, unknown>).copy).toMatchObject({ candidate: good.name, decidedBy: `owner:queue.pick#${QUEUE_ID}`, basis: "bulk" });
    // Every decision is its own event naming the record, and R02 finds nothing on the record.
    expect(((json(join(w.dir, "ledger.json")).events ?? []) as { op: string; record?: string }[]).filter(event => event.op === "pick" || event.op === "pin").map(event => `${event.op} ${event.record}`)).toEqual(["pick copy", "pin copy", "pin copy"]);
    expect(runGuard(w.consumer, "pin", [{ agent: "writer", slot: SLOT, candidate: good.name, records: [`clossys/agents/writer/${SLOT}/pin.json`] }]).filter(row => row.check.startsWith("R02"))).toEqual([]);
  });

  it("not-needed (guard on): an owner's queue answer sets a slot/2 slot aside; a bare owner is refused", async () => {
    const w = world();
    // The not-needed write runs the pin guard (U13 r4, 4c): R02.2 judges the slot's upstream, so it is pinned first.
    w.pinUpstream();
    const before = tree(w.consumer);
    const bare = await runPinCli([`writer/${SLOT}`, "--not-needed", "--reason", "not on this site", "--by", "owner", "--at", AT, "--root", w.root], w.root);
    expect(bare.exitCode).toBe(1);
    expect(tree(w.consumer)).toEqual(before);
    w.queueEntry("not-needed");
    const result = await runPinCli([`writer/${SLOT}`, "--not-needed", "--reason", "not on this site", "--by", `owner:queue.pick#${QUEUE_ID}`, "--at", AT, "--root", w.root], w.root);
    expect(result.exitCode, result.message).toBe(0);
    const slot = json(join(w.dir, "slot.json"));
    expect(slot).toMatchObject({ schema: "clossys.slot/2", status: "parked", contract: { notNeeded: { reason: "not on this site", decidedBy: `owner:queue.pick#${QUEUE_ID}` } } });
  });

  it("approve: the owner's approval is a gated pin-map record with basis picked naming its queue entry", async () => {
    const w = world();
    w.pinUpstream();
    const good = w.submit();
    w.queueEntry({ candidate: good.name });
    const bare = await runApproveCli([`writer/${SLOT}`, good.name, "--by", "owner", "--at", AT, "--root", w.root], w.root);
    expect(bare.exitCode).not.toBe(0);
    expect(existsSync(join(w.dir, "pin.json"))).toBe(false);
    const result = await runApproveCli([`writer/${SLOT}`, good.name, "--by", `owner:queue.pick#${QUEUE_ID}`, "--at", AT, "--root", w.root], w.root);
    expect(result.exitCode, result.message).toBe(0);
    const pin = expectOneFormat(w.dir, "writer", SLOT);
    expect((pin.records as Record<string, unknown>).copy).toMatchObject({ candidate: good.name, decidedBy: `owner:queue.pick#${QUEUE_ID}`, basis: "picked" });
    expect(JSON.stringify(pin.refs ?? (pin.records as Record<string, { refs?: unknown }>).copy)).toContain(QUEUE_ID);
    // An agent pick never replaces the owner's: pick refuses over it and the record is unchanged.
    const bytes = readFileSync(join(w.dir, "pin.json"), "utf8");
    const pick = await runPickCli([`writer/${SLOT}#copy`, good.name, "--by", "agent:writer", "--at", LATER, "--root", w.root], w.root);
    expect(pick.exitCode).toBe(1);
    expect(pick.message).toMatch(/already holds an owner pick/);
    expect(readFileSync(join(w.dir, "pin.json"), "utf8")).toBe(bytes);
    // A foreign seat is refused by the seat rule before anything else is judged.
    const foreign = await runPickCli([`writer/${SLOT}#copy`, good.name, "--by", "agent:designer", "--at", LATER, "--root", w.root], w.root);
    expect(foreign).toMatchObject({ exitCode: 1, message: expect.stringMatching(/^pick refused: .*an agent acts only on its own slots/) });
    expect(readFileSync(join(w.dir, "pin.json"), "utf8")).toBe(bytes);
  });

  it("B1 (guard on): pick, planner pin and owner approve refuse while the slots the copy depends on are unpinned, writing nothing", async () => {
    const w = world();
    const good = w.submit();
    const GUARD = /refused by the constitution guard: .*R02\.2 dependency set not pinned upstream: advantage\.proposition\.promise unpinned.*R20\.2 copy-v1\.md: frontmatter reason cites director:advantage\.proposition\.promise, which is not a pinned Director slot/;
    const before = tree(w.root);
    const pick = await runPickCli([`writer/${SLOT}#copy`, good.name, "--by", "agent:writer", "--at", AT, "--root", w.root], w.root);
    expect(pick).toMatchObject({ exitCode: 1, message: expect.stringMatching(GUARD) });
    expect(tree(w.root)).toEqual(before);
    const planner = await runPinCli([`writer/${SLOT}#copy`, good.name, "--by", "planner:U13", "--at", AT, "--root", w.root], w.root);
    expect(planner).toMatchObject({ exitCode: 1, message: expect.stringMatching(GUARD) });
    expect(tree(w.root)).toEqual(before);
    w.queueEntry({ candidate: good.name });
    const entered = tree(w.root);
    const approve = await runApproveCli([`writer/${SLOT}`, good.name, "--by", `owner:queue.pick#${QUEUE_ID}`, "--at", AT, "--root", w.root], w.root);
    expect(approve.exitCode).not.toBe(0);
    expect(approve.message).toMatch(GUARD);
    expect(tree(w.root)).toEqual(entered);
    expect(existsSync(join(w.dir, "pin.json"))).toBe(false);
    // Once the upstream is pinned the same pick passes the guard.
    w.pinUpstream();
    expect((await runPickCli([`writer/${SLOT}#copy`, good.name, "--by", "agent:writer", "--at", AT, "--root", w.root], w.root)).exitCode).toBe(0);
  });

  it("B2 (guard on): approve, bulk and picked pin and not-needed refuse every entry but the owner's typed, bound answer, writing nothing", async () => {
    const w = world();
    w.pinUpstream();
    const good = w.submit();
    const other = writeCandidate(w.consumer, "writer", SLOT, "copy", GOOD.replace("Ship your site this week", "Launch your site this week"), { at: AT, provenance: { by: "agent:writer", model: "claude-opus-5-5", tier: "high" } });
    const by = `owner:queue.pick#${QUEUE_ID}`;
    const verbs: [string, OwnerEntryInput["answer"], () => Promise<{ exitCode: number; message: string }>][] = [
      ["approve", { candidate: good.name }, () => runApproveCli([`writer/${SLOT}`, good.name, "--by", by, "--at", AT, "--root", w.root], w.root)],
      ["pin --basis bulk", { candidate: good.name }, () => runPinCli([`writer/${SLOT}#copy`, good.name, "--by", by, "--basis", "bulk", "--at", AT, "--root", w.root], w.root)],
      ["pin --basis picked", { candidate: good.name }, () => runPinCli([`writer/${SLOT}#copy`, good.name, "--by", by, "--basis", "picked", "--at", AT, "--root", w.root], w.root)],
      ["not-needed", "not-needed", () => runPinCli([`writer/${SLOT}`, "--not-needed", "--reason", "not on this site", "--by", by, "--at", AT, "--root", w.root], w.root)],
    ];
    const entries: [string, (answer: OwnerEntryInput["answer"]) => void, RegExp][] = [
      ["an untyped {id, kind} object", () => w.bareEntry(), /is not a typed queue entry/],
      ["{}", () => w.bareEntry("{}"), /is not a typed queue entry/],
      ["non-JSON", () => w.bareEntry("owner said yes\n"), /is not JSON/],
      ["an unanswered entry", answer => w.queueEntry(answer, undefined, { status: "open" }), /is open, not answered/],
      ["an entry an agent answered", answer => w.queueEntry(answer, undefined, { answeredBy: "agent:writer" }), /was answered by agent:writer, not the owner/],
      ["an answer about another slot", answer => w.queueEntry(answer, "writer/sections.call-to-action.copy"), /is about writer\/sections\.call-to-action\.copy/],
      ["an answer naming another candidate", answer => w.queueEntry(typeof answer === "string" ? { candidate: other.name } : { candidate: other.name }), new RegExp(`(about candidate|was answered) ${other.name.replace(".", "\\.")}`)],
    ];
    for (const [verb, answer, run] of verbs) {
      for (const [label, write, why] of entries) {
        write(answer);
        const before = tree(w.root);
        const result = await run();
        expect(result.exitCode, `${verb} with ${label}`).not.toBe(0);
        expect(result.message, `${verb} with ${label}`).toMatch(why);
        expect(tree(w.root), `${verb} with ${label}`).toEqual(before);
      }
    }
    expect(existsSync(join(w.dir, "pin.json"))).toBe(false);
    expect(json(join(w.dir, "slot.json")).status).not.toBe("parked");
  });

  it("B2 (guard on): seat refuses a bare, {}, unanswered, foreign or candidate answer after migrate, writing nothing", async () => {
    const w = world();
    const plan = planSlotsMigration(w.root, { at: AT, version: "0.0.0-test" });
    expect(plan.findings).toEqual([]);
    applySlotsMigration(w.root, plan, { at: AT, version: "0.0.0-test" });
    const seat = ["critic", "--by", "agent:producer", "--no-llm", "--decided-by", `owner:queue.pick#${QUEUE_ID}`, "--at", AT, "--root", w.root];
    for (const [label, write, why] of [
      ["an untyped {id, kind} object", () => w.bareEntry(), /is not a typed queue entry/],
      ["{}", () => w.bareEntry("{}"), /is not a typed queue entry/],
      ["an unanswered entry", () => w.queueEntry("seat", "producer/seat.critic", { status: "open" }), /is open, not answered/],
      ["an answer about another seat", () => w.queueEntry("seat", "producer/seat.judge"), /is about producer\/seat\.judge/],
      ["a pick answer naming a candidate", () => w.queueEntry({ candidate: "critic-v1.json" }, "producer/seat.critic"), /not seat/],
    ] as const) {
      write();
      const before = tree(w.root);
      const result = await runSeatCli(seat, w.root);
      expect(result.exitCode, label).toBe(1);
      expect(result.message, label).toMatch(why);
      expect(tree(w.root), label).toEqual(before);
    }
  }, 120_000);

  it("reissue: the next version is a headered candidate, the old one retired, slot.json unchanged", async () => {
    const w = world();
    writeFileSync(join(w.root, "package-lock.json"), `${JSON.stringify({ name: "consumer", lockfileVersion: 3, packages: { "": {} } }, null, 2)}\n`);
    const good = w.submit();
    const slotBytes = readFileSync(join(w.dir, "slot.json"), "utf8");
    w.pinUpstream();
    const result = await runReissueCli([`writer/${SLOT}`, good.name, "--by", "agent:writer", "--at", LATER, "--root", w.root], w.root);
    expect(result.exitCode, result.message).toBe(0);
    const name = (result.decision as { candidate: string }).candidate;
    expect(name).not.toBe(good.name);
    const read = readCandidateFile(join(w.dir, "candidates", name), { agent: "writer", slotId: SLOT });
    expect(read.issues).toEqual([]);
    expect(read.header).toMatchObject({ createdBy: { cli: "clossys reissue" } });
    expect(existsSync(join(w.dir, "candidates", good.name))).toBe(false);
    expect(readFileSync(join(w.dir, "slot.json"), "utf8")).toBe(slotBytes);
    expect(existsSync(join(w.dir, "pin.json"))).toBe(false);
  });

  it("seat: refuses a slot/1 seat; after migrate slots it writes a slot/2 seat, a headered candidate and a pin/2", async () => {
    const w = world();
    const seat = join(w.consumer, "agents", "producer", "seat.critic");
    // A human seat (seat.assigned: a procedure sentence and a clossys command), decided by the planner.
    const args = ["critic", "--by", "agent:producer", "--no-llm", "--procedure", "Read the draft and record one verdict on it.", "--command", "clossys verdict", "--decided-by", "planner:U13", "--at", AT, "--root", w.root];
    const untouched = tree(w.consumer);
    const refused = await runSeatCli(args, w.root);
    expect(refused.exitCode).toBe(1);
    expect(refused.message).toMatch(/clossys\.slot\/1 slot; this verb writes clossys\.slot\/2 and clossys\.pin\/2 only/);
    expect(tree(w.consumer)).toEqual(untouched);
    // A bare owner decider names no queue answer: a usage error, nothing written.
    await expect(runSeatCli(["critic", "--by", "agent:producer", "--no-llm", "--decided-by", "owner", "--root", w.root], w.root)).rejects.toThrow(/--decided-by must be owner:queue/);
    const plan = planSlotsMigration(w.root, { at: AT, version: "0.0.0-test" });
    expect(plan.findings).toEqual([]);
    applySlotsMigration(w.root, plan, { at: AT, version: "0.0.0-test" });
    const result = await runSeatCli(args, w.root);
    expect(result.exitCode, result.message).toBe(0);
    const pin = expectOneFormat(seat, "producer", "seat.critic", true);
    expect(pin).toMatchObject({ schema: "clossys.pin/2", decidedBy: "planner:U13", basis: "planner" });
    expect(json(join(seat, "slot.json"))).toMatchObject({ schema: "clossys.slot/2", kind: "seat" });
  }, 120_000);

  it("seat (B3): an owner packet's seat options name the queue answer; running one records the owner's decision citing it", async () => {
    const w = world();
    const plan = planSlotsMigration(w.root, { at: AT, version: "0.0.0-test" });
    expect(plan.findings).toEqual([]);
    applySlotsMigration(w.root, plan, { at: AT, version: "0.0.0-test" });
    expect(PLACEHOLDER_MEANING[QUEUE_ANSWER]).toMatch(/owner:queue\.<kind>#<id>/);
    const seats = openPackets(w.root).filter(packet => packet.step === "seats").flatMap(packet => packet.options).filter(option => option.argv?.[1] === "seat");
    expect(seats.length).toBeGreaterThan(0);
    for (const option of seats) {
      const argv = option.argv!;
      expect(argv[argv.indexOf("--decided-by") + 1], option.label).toBe(QUEUE_ANSWER);
    }
    const human = seats.find(option => option.argv!.includes("--no-llm"))!;
    const argv = human.argv!.slice(1).map(word => word === QUEUE_ANSWER ? `owner:queue.pick#${QUEUE_ID}` : word);
    w.queueEntry("seat", `producer/seat.${argv[1]}`);
    const result = await runCli([...argv, "--at", AT, "--root", w.root], w.root);
    expect(result.exitCode, result.message).toBe(0);
    const seat = join(w.consumer, "agents", "producer", `seat.${argv[1]}`);
    const pin = expectOneFormat(seat, "producer", `seat.${argv[1]}`, true);
    expect(pin).toMatchObject({ schema: "clossys.pin/2", decidedBy: `owner:queue.pick#${QUEUE_ID}`, basis: "picked" });
    expect(pin.refs).toContainEqual(expect.objectContaining({ to: "producer/queue.pick", record: QUEUE_ID, rel: "answers" }));
  }, 120_000);

  it("ia --under (B2): a new slot on a fresh store is created as clossys.slot/2, and config --init marks the store (N4)", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "one-format-place-")));
    roots.push(root);
    const init = await runCli(["config", "--init", "--root", root], root);
    expect(init.exitCode, init.message).toBe(0);
    expect(existsSync(storeFormatPath(join(root, "clossys")))).toBe(true);
    expect((await runIaCli(["designer", "--start", "--root", root], root)).exitCode).toBe(0);
    const contract = {
      schema: "clossys.slot-contract/1", kind: "section", slot: "sections.fixture", package: "designer", layer: "sections", purpose: "A fixture section.",
      inputs: [{ name: "title", kind: "copy", required: true }], limits: {}, references: [], checkSuite: "section", specimenKind: "visual",
    };
    writeFileSync(join(root, "contract.json"), JSON.stringify(contract));
    const placed = await runIaCli(["designer/sections.fixture", "--contract", join(root, "contract.json"), "--under", "sections/fixture", "--kind", "element", "--root", root], root);
    expect(placed.exitCode, placed.message).toBe(0);
    expect(json(join(root, "clossys", "agents", "designer", "sections.fixture", "slot.json")).schema).toBe("clossys.slot/2");
  }, 120_000);

  it("ia --adopt: a fresh consumer adopts every Director slot as clossys.slot/2", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "one-format-adopt-")));
    roots.push(root);
    const init = await runCli(["config", "--init", "--root", root], root);
    expect(init.exitCode, init.message).toBe(0);
    const adopted = await runCli(["ia", "director", "--adopt", "--root", root], root);
    expect(adopted.exitCode, adopted.message).toBe(0);
    // N4: an adopted store is all clossys.slot/2 and carries the store-format marker, so its readers fail closed.
    expect(existsSync(storeFormatPath(join(root, "clossys")))).toBe(true);
    const found = [...schemas(join(root, "clossys"))].filter(([file]) => file.startsWith("agents/director/") && file.endsWith("slot.json"));
    expect(found.length).toBeGreaterThan(0);
    expect(new Set(found.map(([, schema]) => schema))).toEqual(new Set(["clossys.slot/2"]));
  }, 120_000);
});

describe("each verb refuses a clossys.slot/1 slot and writes nothing", () => {
  const legacy = () => {
    const ws = consumerCopy();
    roots.push(ws.root);
    const consumer = join(ws.root, "clossys");
    const first = (agent: string) => {
      const dir = join(consumer, "agents", agent);
      return readdirSync(dir).filter(name => existsSync(join(dir, name, "slot.json")) && json(join(dir, name, "slot.json")).schema === "clossys.slot/1").sort()[0]!;
    };
    const id = first("designer"), copy = first("writer");
    // The legacy tree holds no candidates: one per slot, so each verb gets as far as the format refusal.
    const candidate = "example-v1.json", copyCandidate = "copy-v1.md";
    mkdirSync(join(consumer, "agents", "designer", id, "candidates"), { recursive: true });
    writeFileSync(join(consumer, "agents", "designer", id, "candidates", candidate), `${JSON.stringify({ name: "example", type: "registry:item", files: [] }, null, 2)}\n`);
    mkdirSync(join(consumer, "agents", "writer", copy, "candidates"), { recursive: true });
    writeFileSync(join(consumer, "agents", "writer", copy, "candidates", copyCandidate), GOOD);
    // An untyped entry may stay here: every verb refuses the slot/1 slot before it resolves an owner answer.
    const queue = join(consumer, "agents", "producer", "queue.pick", "entries", "x.json");
    mkdirSync(join(queue, ".."), { recursive: true });
    writeFileSync(queue, JSON.stringify({ id: "x", kind: "queue-entry" }));
    return { root: ws.root, consumer, id, candidate, copy, copyCandidate };
  };

  it("pin, pick, approve and reissue on a slot/1 store", async () => {
    const l = legacy();
    const before = tree(l.consumer);
    const pin = await runPinCli([`designer/${l.id}`, l.candidate, "--by", "planner:U13", "--root", l.root], l.root);
    expect(pin).toMatchObject({ exitCode: 1, message: expect.stringMatching(MIGRATE) });
    const pick = await runPickCli([`designer/${l.id}`, l.candidate, "--by", "agent:designer", "--root", l.root], l.root);
    expect(pick).toMatchObject({ exitCode: 1, message: expect.stringMatching(MIGRATE) });
    const approve = await runApproveCli([`writer/${l.copy}`, l.copyCandidate, "--by", "owner:queue.pick#x", "--root", l.root], l.root);
    expect(approve.exitCode).toBe(1);
    expect(approve.message).toMatch(MIGRATE);
    const reissue = await runReissueCli([`designer/${l.id}`, l.candidate, "--by", "agent:designer", "--root", l.root], l.root);
    expect(reissue.exitCode).toBe(1);
    expect(reissue.message).toMatch(MIGRATE);
    expect(tree(l.consumer)).toEqual(before);
  }, 120_000);
  it("verdict (B1): a verdict pick on a slot/1 slot refuses with the migrate message and writes no pin/1", () => {
    const l = legacy();
    // A candidate the slot/1 pin writer would accept (it names its source), so only the format can refuse the pick.
    const valid = "valid-v1.json";
    writeFileSync(join(l.consumer, "agents", "designer", l.id, "candidates", valid), `${JSON.stringify({ name: "example", type: "registry:item", files: [], meta: { source: { kind: "registry", ref: ["shadcn-aria/button@4.23.0"] } } }, null, 2)}\n`);
    const before = tree(l.consumer);
    expect(() => writeVerdict(l.consumer, "designer", l.id, { verdict: "pick", pick: valid, reason: "fits", criteria: [] }, { by: "agent:designer", at: AT }, { model: "fixture-model", tier: "high" })).toThrow(MIGRATE);
    expect(existsSync(join(l.consumer, "agents", "designer", l.id, "pin.json"))).toBe(false);
    expect(tree(l.consumer)).toEqual(before);
  });

  it("ia (B2): a contract write on a slot/1 slot refuses with the migrate message, never rewriting it as slot/1", async () => {
    const l = legacy();
    const file = join(l.root, "contract.json");
    // A contract the slot/1 writer would accept (the stored one plus a requirement), so only the format can refuse it.
    const stored = json(join(l.consumer, "agents", "designer", l.id, "slot.json")) as { contract?: Record<string, unknown> };
    writeFileSync(file, `${JSON.stringify({ requirements: [{ check: "text.nonempty" }], ...(stored.contract ?? {}), summary: "rewritten" }, null, 2)}\n`);
    const before = tree(l.consumer);
    const result = await runIaCli([`designer/${l.id}`, "--contract", file, "--root", l.root], l.root);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(MIGRATE);
    expect(tree(l.consumer)).toEqual(before);
  }, 120_000);

  it("options --classes and ia regroup (N1): an old-format slot.json is never rewritten in place", async () => {
    const l = legacy();
    const before = tree(l.consumer);
    expect(() => writeSlotOptions(l.consumer, "designer", l.id, { options: 3, varyOn: "layout" })).toThrow(MIGRATE);
    expect(tree(l.consumer)).toEqual(before);
    // A regroup follows every slot.json position: on a workspace IA whose slots are clossys.slot/1, it is refused.
    const root = realpathSync(mkdtempSync(join(tmpdir(), "one-format-regroup-")));
    roots.push(root);
    const consumer = join(root, "clossys"), agents = join(consumer, "agents", "designer");
    mkdirSync(agents, { recursive: true });
    writeFileSync(join(consumer, "clossys.config.ts"), "export default {};\n");
    writeFileSync(join(consumer, "owner-decisions.json"), jsonBytes({ schema: "clossys.owner-decisions/1", decisions: [{ id: "1", ref: REF, date: "2026-11-18", scope: ["ia"], summary: "Fixture IA decision." }] }));
    const ia: IaDoc = { schema: "clossys.ia/1", source: "workspace#owner", extensions: [], nodes: [{ id: "assets.logo", label: "Logo", children: [{ id: "logo-artwork", label: "Artwork", slots: ["assets.logo-mark"] }, { id: "logo-other", label: "Other", slots: [] }] }] };
    writeFileSync(join(agents, "ia.json"), jsonBytes(ia));
    for (const [id, position] of slotPositions("designer", ia)) {
      mkdirSync(join(agents, id), { recursive: true });
      writeFileSync(join(agents, id, "slot.json"), jsonBytes({ schema: "clossys.slot/1", id, agent: "designer", ia: position, kind: "element", contract: {}, inputs: [], uses: [] }));
    }
    const untouched = tree(consumer);
    const moved = await runIaCli(["designer/assets.logo-mark", "--move", "--under", "assets.logo/logo-other", "--owner-ref", REF, "--at", AT, "--root", root], root);
    expect(moved.exitCode, moved.message).toBe(1);
    expect(moved.message).toMatch(MIGRATE);
    expect(tree(consumer)).toEqual(untouched);
  }, 120_000);
});
