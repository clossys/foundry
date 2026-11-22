/**
 * `clossys ia sync --check` (foundry-feedback-0022): the package IA is the source of truth, so a
 * consumer generated from it has no drift, and every hand edit to its structure is reported.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FIXTURE_CONSUMER_ROOT } from "./fixture-consumer.test.js";
import { certifyStrings } from "../../constitution/certify/strings.js";
import type { CandidateRecord, SlotRecord } from "../../constitution/types.js";
import { consumerStatesFixture } from "../../migrate/contracts.js";
import { designerIa, writerIa } from "./foundry-ia.js";
import { driftCounts, knownSlots, SYNC_AGENTS, syncDrift, syncPlan, syncState, type SyncAgent } from "./ia-sync.js";
import type { IaDoc } from "./types.js";

const fixture = join(FIXTURE_CONSUMER_ROOT, "clossys");
const temps: string[] = [];
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function copy(): string {
  const dir = mkdtempSync(join(tmpdir(), "ia-sync-"));
  temps.push(dir);
  cpSync(fixture, join(dir, "clossys"), { recursive: true });
  return join(dir, "clossys");
}
const iaFile = (consumer: string, agent: string) => join(consumer, "agents", agent, "ia.json");
const readIa = (consumer: string, agent: string) => JSON.parse(readFileSync(iaFile(consumer, agent), "utf8")) as { -readonly [K in keyof IaDoc]: any };
const writeIa = (consumer: string, agent: string, doc: unknown) => writeFileSync(iaFile(consumer, agent), `${JSON.stringify(doc, null, 2)}\n`);

describe("ia sync --check", () => {
  it("finds no drift in a consumer generated from the package IA", () => {
    // The fixture is a full (pre-D5) adopt: its package leaves no publication reaches are listed as unconsumed-leaf, a
    // pending finding (ia.orphans fails them; the adopt re-run removes them). Nothing else is listed.
    for (const agent of SYNC_AGENTS) expect(syncDrift(fixture, agent).filter(finding => finding.kind !== "unconsumed-leaf"), agent).toEqual([]);
  });

  it("reports an unadopted package leaf and a placed leaf that is neither packaged nor declared", () => {
    const consumer = copy();
    const ia = readIa(consumer, "writer");
    const group = ia.nodes[0].children[0];
    const dropped: string = group.slots[0];
    group.slots = [...group.slots.slice(1), "lexicon.not-a-package-leaf"];
    writeIa(consumer, "writer", ia);
    const counts = driftCounts(syncDrift(consumer, "writer"));
    expect(counts["unadopted-leaf"]).toBe(1);
    expect(counts["undeclared-leaf"]).toBe(1);
    expect(syncDrift(consumer, "writer").find(finding => finding.kind === "unadopted-leaf")?.slot).toBe(dropped);
  });

  it("reports a contract or layer edit", () => {
    const consumer = copy();
    const ia = readIa(consumer, "designer");
    const group = ia.nodes[0].children[0];
    const leaf: string = group.slots[0];
    ia.layers = [{ id: "hand", label: "Hand", nodes: [ia.nodes[0].id] }];
    writeIa(consumer, "designer", ia);
    const slotFile = join(consumer, "agents", "designer", leaf, "slot.json");
    const slot = JSON.parse(readFileSync(slotFile, "utf8"));
    writeFileSync(slotFile, `${JSON.stringify({ ...slot, contract: { ...slot.contract, purpose: "edited in the consumer" } }, null, 2)}\n`);
    const kinds = syncDrift(consumer, "designer").map(finding => finding.kind);
    expect(kinds).toContain("layers");
    expect(kinds).toContain("contract");
    expect(kinds).not.toContain("undeclared-leaf");
  });

  it("reports a behaviour edit: standard, options/varyOn and inputs are package data", () => {
    const consumer = copy();
    const edit = (agent: string, slot: string, change: (doc: any) => void) => {
      const file = join(consumer, "agents", agent, slot, "slot.json");
      const doc = JSON.parse(readFileSync(file, "utf8"));
      change(doc);
      writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    };
    // The fixture is a recut (clossys.slot/2) store: inputs are the slot's input refs, echoed in brief.inputs.
    const dropFirstInput = (doc: any) => {
      const first: string = doc.refs.find((ref: { rel: string }) => ref.rel === "input").to;
      const kept = (ref: { to: string; rel: string }) => !(ref.rel === "input" && ref.to === first);
      doc.refs = doc.refs.filter(kept);
      doc.brief.inputs = doc.brief.inputs.filter(kept);
    };
    const behaviour = (agent: typeof SYNC_AGENTS[number]) => syncDrift(consumer, agent).filter(finding => finding.kind === "behaviour").map(finding => finding.slot);
    // Drift the unedited copy already shows (the Designer residual of the recut: components.icon still names two
    // icons Designer's retired.json retires) is not the edit's; each edit adds exactly its slot.
    const before = Object.fromEntries(SYNC_AGENTS.map(agent => [agent, behaviour(agent)])) as Record<typeof SYNC_AGENTS[number], (string | undefined)[]>;
    edit("writer", "sections.hero.copy", doc => { doc.standard = "string"; });
    edit("director", "identity.naming.name", doc => { delete doc.options; delete doc.varyOn; });
    edit("designer", "sections.hero", dropFirstInput);
    expect(before.writer).toEqual([]);
    expect(before.director).toEqual([]);
    expect(behaviour("writer")).toEqual(["sections.hero.copy"]);
    expect(behaviour("director")).toEqual(["identity.naming.name"]);
    expect(behaviour("designer").filter(slot => !before.designer.includes(slot))).toEqual(["sections.hero"]);
  });
});

/**
 * U-CHECKALIGN (owner Q8, 2026-11-22): a Writer slot whose package contract neither declares nor derives a fixture
 * (a Voice or Prose rule: no copy fields) leaves `contract.fixture` to the consumer. ia-sync does not compare that
 * field and a sync writes it back; every other contract field, every package-declared or copy-derived fixture and
 * every Designer fixture stays package data; certify still judges the consumer's fixture in full.
 */
describe("ia sync: a Writer fixture the package does not determine is the consumer's", () => {
  const slotPath = (consumer: string, agent: string, id: string) => join(consumer, "agents", agent, id, "slot.json");
  const readSlot = (consumer: string, agent: string, id: string) => JSON.parse(readFileSync(slotPath(consumer, agent, id), "utf8"));
  const editSlot = (consumer: string, agent: string, id: string, change: (doc: any) => void) => {
    const doc = readSlot(consumer, agent, id);
    change(doc);
    writeFileSync(slotPath(consumer, agent, id), `${JSON.stringify(doc, null, 2)}\n`);
  };
  const contractRows = (consumer: string, agent: SyncAgent) => syncDrift(consumer, agent).filter(finding => finding.kind === "contract").map(finding => finding.slot);
  const planOf = (consumer: string, agent: SyncAgent) => {
    const state = syncState(consumer, agent);
    const plan = syncPlan(consumer, agent, knownSlots(consumer, agent, state), state);
    if ("error" in plan) throw new Error(plan.error);
    return plan;
  };
  /** The contract a sync leaves in a slot.json: the planned write's, else the file's own. */
  const syncedContract = (consumer: string, agent: SyncAgent, id: string, plan = planOf(consumer, agent)) => {
    const write = plan.writes.find(([file]) => file === slotPath(consumer, agent, id));
    return (write ? JSON.parse(write[1]) : readSlot(consumer, agent, id)).contract;
  };
  const lexicon = [...writerIa().slots.values()].filter(slot => slot.id.startsWith("lexicon.")).map(slot => slot.id).sort();

  it("the package states no fixture for the 12 lexicon slots, and does for a copy slot", () => {
    expect(lexicon).toHaveLength(12);
    for (const id of lexicon) expect(consumerStatesFixture("writer", writerIa().slots.get(id)!.contract), id).toBe(true);
    expect(consumerStatesFixture("writer", writerIa().slots.get("sections.hero.copy")!.contract)).toBe(false);
  });

  it("keeps a consumer-stated fixture: no contract drift, and a sync writes it back unchanged", () => {
    expect(contractRows(fixture, "writer")).toEqual([]);
    const consumer = copy();
    const plan = planOf(consumer, "writer");
    for (const id of lexicon) {
      const stated = readSlot(consumer, "writer", id).contract.fixture;
      expect(stated, id).toBeDefined();
      expect(syncedContract(consumer, "writer", id, plan).fixture, id).toEqual(stated);
    }
  });

  it("a consumer edit of its own stated fixture is not drift and survives a sync", () => {
    const consumer = copy();
    const edited = { keys: ["register", "address", "tone"], locales: ["en", "fr"] };
    editSlot(consumer, "writer", "lexicon.formality", doc => { doc.contract.fixture = edited; });
    expect(contractRows(consumer, "writer")).toEqual([]);
    expect(syncedContract(consumer, "writer", "lexicon.formality").fixture).toEqual(edited);
  });

  it("still reports a fixture edit where the package derives one", () => {
    const consumer = copy();
    editSlot(consumer, "writer", "sections.hero.copy", doc => { doc.contract.fixture.keys = [...doc.contract.fixture.keys, "header.not-a-field"]; });
    expect(contractRows(consumer, "writer")).toEqual(["sections.hero.copy"]);
    expect(syncedContract(consumer, "writer", "sections.hero.copy").fixture.keys).not.toContain("header.not-a-field");
  });

  it("still reports any other contract edit on a slot whose fixture the consumer states", () => {
    const consumer = copy();
    editSlot(consumer, "writer", "lexicon.formality", doc => { doc.contract.shape = "voice.edited-in-the-consumer"; });
    expect(contractRows(consumer, "writer")).toEqual(["lexicon.formality"]);
  });

  it("a Designer fixture stays package-compared", () => {
    const consumer = copy();
    const before = contractRows(consumer, "designer");
    const id = [...designerIa().slots.values()].map(slot => slot.id).sort().find(slot => designerIa().slots.get(slot)!.contract.fixture === undefined
      && !before.includes(slot) && (() => { try { const doc = readSlot(consumer, "designer", slot); return doc.schema === "clossys.slot/2" && doc.contract?.fixture === undefined; } catch { return false; } })());
    expect(id).toBeDefined();
    editSlot(consumer, "designer", id!, doc => { doc.contract.fixture = { file: "hand.tsx", export: "Hand" }; });
    expect(contractRows(consumer, "designer").filter(slot => !before.includes(slot))).toEqual([id]);
  });

  it("certify still judges the consumer-stated fixture in full (R05.1)", () => {
    const consumer = copy();
    const contract = syncedContract(consumer, "writer", "lexicon.formality") as Record<string, unknown>;
    const slot = { id: "lexicon.formality" } as unknown as SlotRecord;
    const candidate = (ids: string[]) => ({ text: [
      "---", 'slot: "lexicon.formality"', 'locales: ["en"]', "---", "## en", "",
      ...ids.flatMap(id => [`### ${id}`, `<!-- {"id":"${id}","bindings":[]} -->`, "```json", JSON.stringify({ id, context: id, kind: "voice-rule", rule: "A rule", value: "v" }), "```", ""]),
    ].join("\n") }) as unknown as CandidateRecord;
    expect(certifyStrings(slot, candidate(["register", "address"]), contract)).toEqual([]);
    expect(certifyStrings(slot, candidate(["register"]), contract)).toEqual([expect.objectContaining({ code: "fixture", message: expect.stringMatching(/address/) })]);
    expect(certifyStrings(slot, candidate(["register", "address", "extra"]), contract)).toEqual([expect.objectContaining({ code: "fixture", message: expect.stringMatching(/extra/) })]);
    const { fixture: _fixture, ...bare } = contract;
    expect(certifyStrings(slot, candidate(["register", "address"]), bare).map(reason => reason.code)).toEqual(["no-fixture"]);
  });
});
