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
import { afterAll, describe, expect, it } from "vitest";
import { sha256Hex } from "../records/hash.js";
import { readCandidateFile } from "../records/candidate.js";
import { writeCandidate, writePin } from "../records/slot-write.js";
import { consumerCopy } from "../records/__fixtures__/slot2-workspace.js";
import { applySlotsMigration, planSlotsMigration } from "../migrate/slots.js";
import { runCli } from "./main.js";
import { runPickCli } from "./options.js";
import { runApproveCli, runSeatCli } from "./owner.js";
import { runPinCli } from "./pin.js";
import { runReissueCli } from "./reissue.js";

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
    queueEntry(): void {
      const file = join(consumer, "agents", "producer", "queue.pick", "entries", `${QUEUE_ID}.json`);
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, JSON.stringify({ id: QUEUE_ID, kind: "queue-entry" }));
    },
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
    const good = w.submit();
    const before = schemas(w.consumer);
    const result = await runPickCli([`writer/${SLOT}#copy`, good.name, "--by", "agent:writer", "--at", AT, "--root", w.root], w.root);
    expect(result.exitCode, result.message).toBe(0);
    const pin = expectOneFormat(w.dir, "writer", SLOT);
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

  it("confirm: the owner's confirm keeps the agent pick and stays a pin-map record", async () => {
    const w = world();
    const good = w.submit();
    expect((await runPickCli([`writer/${SLOT}#copy`, good.name, "--by", "agent:writer", "--at", AT, "--root", w.root], w.root)).exitCode).toBe(0);
    const result = await runPinCli([`writer/${SLOT}#copy`, good.name, "--confirm", "--ref", REF, "--at", LATER, "--root", w.root], w.root, false);
    expect(result.exitCode, result.message).toBe(0);
    const pin = expectOneFormat(w.dir, "writer", SLOT);
    expect((pin.records as Record<string, unknown>).copy).toMatchObject({ candidate: good.name, basis: "agent", decidedBy: "agent:writer", confirmed: { by: "owner", ref: REF, at: LATER } });
    // A second confirm is refused and changes nothing.
    const bytes = readFileSync(join(w.dir, "pin.json"), "utf8");
    expect((await runPinCli([`writer/${SLOT}#copy`, good.name, "--confirm", "--ref", REF, "--at", LATER, "--root", w.root], w.root, false)).exitCode).toBe(1);
    expect(readFileSync(join(w.dir, "pin.json"), "utf8")).toBe(bytes);
  });

  it("approve: the owner's approval is a gated pin-map record with basis picked naming its queue entry", async () => {
    const w = world();
    const good = w.submit();
    w.queueEntry();
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

  it("reissue: the next version is a headered candidate, the old one retired, slot.json unchanged", async () => {
    const w = world();
    writeFileSync(join(w.root, "package-lock.json"), `${JSON.stringify({ name: "consumer", lockfileVersion: 3, packages: { "": {} } }, null, 2)}\n`);
    const good = w.submit();
    const slotBytes = readFileSync(join(w.dir, "slot.json"), "utf8");
    const result = await runReissueCli([`writer/${SLOT}`, good.name, "--by", "agent:writer", "--at", LATER, "--root", w.root], w.root, false);
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
    const args = ["critic", "--by", "agent:critic", "--no-llm", "--decided-by", "planner:U13", "--at", AT, "--root", w.root];
    const untouched = tree(w.consumer);
    const refused = await runSeatCli(args, w.root);
    expect(refused.exitCode).toBe(1);
    expect(refused.message).toMatch(/clossys\.slot\/1 slot; this verb writes clossys\.slot\/2 and clossys\.pin\/2 only/);
    expect(tree(w.consumer)).toEqual(untouched);
    // A bare owner decider names no queue answer: a usage error, nothing written.
    await expect(runSeatCli(["critic", "--by", "agent:critic", "--no-llm", "--decided-by", "owner", "--root", w.root], w.root)).rejects.toThrow(/--decided-by must be owner:queue/);
    const plan = planSlotsMigration(w.root, { at: AT, version: "0.0.0-test" });
    expect(plan.findings).toEqual([]);
    applySlotsMigration(w.root, plan, { at: AT, version: "0.0.0-test" });
    const result = await runSeatCli(args, w.root);
    expect(result.exitCode, result.message).toBe(0);
    const pin = expectOneFormat(seat, "producer", "seat.critic", true);
    expect(pin).toMatchObject({ schema: "clossys.pin/2", decidedBy: "planner:U13", basis: "planner" });
    expect(json(join(seat, "slot.json"))).toMatchObject({ schema: "clossys.slot/2", kind: "seat" });
  }, 120_000);

  it("ia --adopt: a fresh consumer adopts every Director slot as clossys.slot/2", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "one-format-adopt-")));
    roots.push(root);
    const init = await runCli(["config", "--init", "--root", root], root);
    expect(init.exitCode, init.message).toBe(0);
    const adopted = await runCli(["ia", "director", "--adopt", "--root", root], root);
    expect(adopted.exitCode, adopted.message).toBe(0);
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
    const queue = join(consumer, "agents", "producer", "queue.pick", "entries", "x.json");
    mkdirSync(join(queue, ".."), { recursive: true });
    writeFileSync(queue, JSON.stringify({ id: "x", kind: "queue-entry" }));
    return { root: ws.root, consumer, id, candidate, copy, copyCandidate };
  };

  it("pin, pick, approve and reissue on a slot/1 store", async () => {
    const l = legacy();
    const before = tree(l.consumer);
    const pin = await runPinCli([`designer/${l.id}`, l.candidate, "--by", "planner:U13", "--root", l.root], l.root, false);
    expect(pin).toMatchObject({ exitCode: 1, message: expect.stringMatching(MIGRATE) });
    const pick = await runPickCli([`designer/${l.id}`, l.candidate, "--by", "agent:designer", "--root", l.root], l.root);
    expect(pick).toMatchObject({ exitCode: 1, message: expect.stringMatching(MIGRATE) });
    const approve = await runApproveCli([`writer/${l.copy}`, l.copyCandidate, "--by", "owner:queue.pick#x", "--root", l.root], l.root);
    expect(approve.exitCode).toBe(1);
    expect(approve.message).toMatch(MIGRATE);
    const reissue = await runReissueCli([`designer/${l.id}`, l.candidate, "--by", "agent:designer", "--root", l.root], l.root, false);
    expect(reissue.exitCode).toBe(1);
    expect(reissue.message).toMatch(MIGRATE);
    expect(tree(l.consumer)).toEqual(before);
  }, 120_000);
});
