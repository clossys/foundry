import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LEDGER_FILE } from "./ledger.js";
import { SeatRefusal } from "./seat-owner.js";
import { jsonBytes, serializeFrontmatter, slotPositions, type IaDoc } from "./slot-model/index.js";
import { appendCraftEvent, appendRetireCandidate, appendRetireSlot, writeCandidate, writeCritique } from "./slot-write.js";

// foundry-build-0048 U7 r3: every slot writer that takes a caller's `by` goes through the total actor guard
// (records/seat-owner.ts assertActor), so a direct caller cannot skip the CLI's check.
const ID = "identity.brand.essence";
const at = "2026-11-13T00:00:00Z";
const source = { kind: "original", ref: [] };
const body = "## Direction\n- Essence: x\n\n## Because\n- y\n\n## Watch\n- z\n";
const brief = (essence: string) => serializeFrontmatter({ slot: ID, source, feeds: [], functions: [] }, body.replace("Essence: x", `Essence: ${essence}`));
const APPROVAL = "20261113T0000Z-retire";
let root: string, consumer: string, dir: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "slot-write-")));
  consumer = join(root, "clossys");
  const ia: IaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [
    { id: "identity", label: "Identity", children: [{ id: "identity.brand", label: "Brand", slots: [ID] }] },
  ] };
  mkdirSync(join(consumer, "agents", "director"), { recursive: true });
  writeFileSync(join(consumer, "agents", "director", "ia.json"), jsonBytes(ia));
  dir = join(consumer, "agents", "director", ID);
  mkdirSync(join(dir, "candidates"), { recursive: true });
  writeFileSync(join(dir, "slot.json"), jsonBytes({ schema: "clossys.slot/1", id: ID, agent: "director", ia: slotPositions("director", ia).get(ID), kind: "brief", contract: {}, inputs: [], uses: [] }));
  writeFileSync(join(consumer, "clossys.config.ts"), "export default {};\n");
  const entries = join(consumer, "agents", "producer", "queue.approve", "entries");
  mkdirSync(entries, { recursive: true });
  writeFileSync(join(entries, `${APPROVAL}.json`), jsonBytes({
    schema: "clossys.queue-entry/1", id: APPROVAL, agent: "producer", kind: "queue-entry", status: "answered", createdBy: { actor: "code", cli: "clossys test", version: "0.0.0" },
    createdAt: at, refs: [], queue: "queue.approve", ask: "Retire it?", subject: { to: `director/${ID}`, rel: "input" }, decider: "owner",
    options: [{ id: "retire", summary: "retire" }], default: null,
    events: [{ at, op: "raised", by: "code:clossys test" }, { at, op: "answered", by: "owner", via: "chat", answer: "retire", quote: "retire it" }],
  }));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const ledgerBytes = () => (existsSync(join(dir, LEDGER_FILE)) ? readFileSync(join(dir, LEDGER_FILE), "utf8") : undefined);
const agentLedgerBytes = () => (existsSync(join(consumer, "agents", "director", LEDGER_FILE)) ? readFileSync(join(consumer, "agents", "director", LEDGER_FILE), "utf8") : undefined);
const FOREIGN = ["agent:writer", "agent:judge", "agent:director-x", "owner", "planner", "migration", "migrated", "owner:queue.approve#20261113T0000Z-missing", "bob"];
/** The error a call throws, or undefined when it returns. */
const thrown = (run: () => unknown): unknown => { try { run(); return undefined; } catch (error) { return error; } };

describe("T3: the retire writers refuse a foreign actor (records/slot-write.ts)", () => {
  it.each(FOREIGN)("appendRetireCandidate and appendRetireSlot throw a SeatRefusal for --by %s and append nothing", by => {
    writeCandidate(consumer, "director", ID, "essence", brief("one"), { at, provenance: { by: "agent:director" } });
    const before = ledgerBytes(), agentBefore = agentLedgerBytes();
    const candidate = thrown(() => appendRetireCandidate(consumer, "director", ID, { name: "essence-v1.md", sha256: "f".repeat(64), reason: "superseded: v2", by, at }));
    expect(candidate).toBeInstanceOf(SeatRefusal);
    expect(String((candidate as Error).message)).toMatch(/^retire refused: --by /);
    const slot = thrown(() => appendRetireSlot(consumer, "director", ID, { reason: "not-needed: merged", by, at }));
    expect(slot).toBeInstanceOf(SeatRefusal);
    expect(ledgerBytes()).toBe(before);
    expect(agentLedgerBytes()).toBe(agentBefore);
  });

  it("accepts the slot's own seat and a resolved owner answer", () => {
    writeCandidate(consumer, "director", ID, "essence", brief("one"), { at, provenance: { by: "agent:director" } });
    expect(appendRetireCandidate(consumer, "director", ID, { name: "essence-v1.md", sha256: "f".repeat(64), reason: "superseded: v2", by: "agent:director.critic", at })).toMatchObject({ op: "retire-candidate", by: "agent:director.critic" });
    expect(appendRetireSlot(consumer, "director", ID, { reason: "not-needed: merged", by: `owner:queue.approve#${APPROVAL}`, at }).map(event => event.by)).toEqual([`owner:queue.approve#${APPROVAL}`, `owner:queue.approve#${APPROVAL}`]);
  });
});

describe("T15: the candidate, critique and craft writers refuse a foreign seat (defence in depth)", () => {
  it.each(["agent:writer", "agent:judge", "agent:seats", "migration", "bob"])("writeCandidate, writeCritique and appendCraftEvent throw a SeatRefusal for by %s and write nothing", by => {
    const candidate = thrown(() => writeCandidate(consumer, "director", ID, "essence", brief("one"), { at, provenance: { by } }));
    expect(candidate).toBeInstanceOf(SeatRefusal);
    expect(String((candidate as Error).message)).toMatch(/^candidate refused: --by /);
    expect(existsSync(join(dir, "candidates", "essence-v1.md"))).toBe(false);
    const critique = thrown(() => writeCritique(consumer, "director", ID, { verdict: "x" }, { at, validate: () => [] }, { by }));
    expect(critique).toBeInstanceOf(SeatRefusal);
    expect(existsSync(join(dir, "critiques"))).toBe(false);
    const craft = thrown(() => appendCraftEvent(consumer, "director", ID, "brief", {}, { by, at }));
    expect(craft).toBeInstanceOf(SeatRefusal);
    expect(ledgerBytes()).toBeUndefined();
  });

  it("lets the slot's own seat, the owner and the planner author: the guard does not refuse them", () => {
    for (const by of ["agent:director", "agent:director.critic", "owner", "planner", `owner:queue.approve#${APPROVAL}`]) {
      expect(thrown(() => writeCritique(consumer, "director", ID, { verdict: "x" }, { at, validate: () => [] }, { by }))).not.toBeInstanceOf(SeatRefusal);
      expect(thrown(() => appendCraftEvent(consumer, "director", ID, "brief", {}, { by, at }))).not.toBeInstanceOf(SeatRefusal);
    }
    expect(writeCandidate(consumer, "director", ID, "essence", brief("one"), { at, provenance: { by: "agent:director" } }).name).toBe("essence-v1.md");
    expect(writeCandidate(consumer, "director", ID, "essence", brief("two"), { at }).name).toBe("essence-v2.md");
  });
});
