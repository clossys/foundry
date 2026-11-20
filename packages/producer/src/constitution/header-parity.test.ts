/**
 * Header parity (foundry-build-0048 U37c T2): a clossys.candidate/1 header changes how a candidate is stored, never
 * what the constitution finds in it. In each fixture world that holds a clossys.slot/2 slot of a viewed kind, one
 * candidate is written headered under that slot, and in a second copy of the world its view is written as the int2
 * control under the same slot rewritten as its clossys.slot/1 reader view. The rows about that candidate, per rule id,
 * must match. HEADER_RULES is the allowlist of rules whose rows may differ between the two; it is empty.
 *
 * The candidate shares its content with an int2 file in another slot of the same agent, so R06.6 (identical content
 * across slots) is judged on both sides. Its header carries no `record` or `briefSha256`: those header content fields
 * have no int2 form, so an int2 control could not hold the same content. consumer-legacy-tree has no slot/2 slot.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { candidateHeaderOf, candidateView, headeredMarkdown, readSlotValue, viewsCandidate } from "../records/slot-current.js";
import { jsonBytes, slotPositions, validateSlotDoc, type ModelAgent, type SlotAgent } from "../records/slot-model/index.js";
import { readIa } from "../records/slots.js";
import type { Actor, AgentId, Iso, SlotId } from "../records/types.js";
import { NO_HISTORY } from "./__fixtures__/workspace.js";
import { runConstitution } from "./run.js";

const FIXTURES = fileURLToPath(new URL("../../test-fixtures/", import.meta.url));
/** Rules whose rows may differ between a headered candidate and its int2 control. Empty: no rule reads the header. */
const HEADER_RULES: readonly string[] = [];
const AT = "2026-11-17T12:00:00Z" as Iso;
const BY: Actor = { actor: "code", cli: "clossys test", version: "0.0.0" };
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

interface Case {
  readonly world: string;
  readonly agent: ModelAgent;
  /** The slot/2 slot the headered candidate is written under. */
  readonly slot: string;
  /** Its new candidate file. */
  readonly name: string;
  /** Another slot of the agent, given an int2 file of the same content. */
  readonly twin: { readonly slot: string; readonly name: string };
  /** Checks the headered candidate must be found by (each reads the view: the header's source, the body). */
  readonly expect: readonly string[];
  /** The headered candidate and its int2 view, from the world as copied. */
  readonly make: (consumer: string) => { readonly headered: string; readonly view: string };
}

const candidateFile = (consumer: string, agent: string, slot: string, name: string) => join(consumer, "agents", agent, slot, "candidates", name);
const write = (path: string, bytes: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); };

const CASES: readonly Case[] = [
  {
    // Markdown: the Director brief of focus.segment.core (its pinned core-v1.md's content) as a new headered version.
    world: "consumer", agent: "director", slot: "focus.segment.core", name: "core-v2.md",
    twin: { slot: "identity.brand.essence", name: "essence-v9.md" }, expect: ["R06.6"],
    make: consumer => {
      const view = candidateView("core-v1.md", readFileSync(candidateFile(consumer, "director", "focus.segment.core", "core-v1.md"), "utf8"));
      const headered = headeredMarkdown("core-v2.md", view, { agent: "director" as AgentId, slotId: "focus.segment.core" as SlotId, createdBy: BY, createdAt: AT });
      return { headered, view: candidateView("core-v2.md", headered) };
    },
  },
  {
    // JSON: the Writer lexicon sentence-length-v2.json's content as a new headered version (`{clossys, content}`).
    world: "tallyhouse", agent: "writer", slot: "lexicon.sentence-length", name: "sentence-length-v3.json",
    twin: { slot: "sections.hero.copy", name: "copy-v9.json" }, expect: ["R06.6", "R07.1"],
    make: consumer => {
      const doc = JSON.parse(readFileSync(candidateFile(consumer, "writer", "lexicon.sentence-length", "sentence-length-v2.json"), "utf8")) as { clossys: Record<string, unknown> };
      const { briefSha256: _brief, record: _record, ...header } = doc.clossys;
      // Its source also cites a Director slot the slot does not read (R07.1), so a rule reads the header's source here.
      const source = header.source as { kind: string; ref: string[] };
      const headered = jsonBytes({ ...doc, clossys: { ...header, id: "writer/lexicon.sentence-length/sentence-length-v3.json", createdBy: BY, createdAt: AT, source: { ...source, ref: [...source.ref, "director:identity.naming.name"] } } });
      return { headered, view: candidateView("sentence-length-v3.json", headered) };
    },
  },
];

function copyWorld(world: string): { root: string; consumer: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `header-parity-${world}-`)));
  roots.push(root);
  cpSync(join(FIXTURES, world), root, { recursive: true });
  return { root, consumer: join(root, "clossys") };
}

/** The slot.json as its clossys.slot/1 reader view: no `family`, and the ia as slot/1 writes it (ia.json's position of the leaf). */
function slotV1(consumer: string, agent: ModelAgent, slot: string): Record<string, unknown> {
  const read = readSlotValue(JSON.parse(readFileSync(join(consumer, "agents", agent, slot, "slot.json"), "utf8")));
  if (!read) throw new Error(`${agent}/${slot}: slot.json does not read valid, so it has no slot/1 view`);
  const { family: _family, ...view } = read.doc as typeof read.doc & { family?: unknown };
  let position: { l0: string; l1: string; l2: string; order: number } | undefined;
  try {
    const ia = readIa(consumer, agent as SlotAgent);
    position = ia ? slotPositions(agent, ia).get(slot) : undefined;
  } catch { position = undefined; } // an ia.json the reader refuses places no leaf: the view's ia is kept
  const doc = { ...view, schema: "clossys.slot/1", ...(position ? { ia: { l0: position.l0, l1: position.l1, l2: position.l2, order: position.order } } : {}) };
  expect(validateSlotDoc(doc, `${slot}/slot.json`), `${agent}/${slot} slot/1 view`).toEqual([]);
  return doc;
}

/** The rows about the candidate, per rule id. */
function rowsByRule(root: string, consumer: string, c: Case): Record<string, string[]> {
  const rows = runConstitution({ root, consumer, history: () => NO_HISTORY, now: () => 0 }).rows
    .filter(row => row.agent === c.agent && row.slot === c.slot && (row.candidate === c.name || row.path.endsWith(`/${c.name}`)));
  const out: Record<string, string[]> = {};
  for (const row of rows) (out[row.rule] ??= []).push(`${row.check} ${row.path}: ${row.reason}`);
  for (const id of Object.keys(out)) out[id]!.sort();
  return out;
}

describe("a candidate's clossys.candidate/1 header changes no constitution row (T2)", () => {
  for (const c of CASES) {
    it(`${c.world}: ${c.agent}/${c.slot}/${c.name} headered under slot/2 and its int2 view under slot/1 give the same rows per rule`, () => {
      const written = copyWorld(c.world);
      const control = copyWorld(c.world);
      expect(viewsCandidate(JSON.parse(readFileSync(join(written.consumer, "agents", c.agent, c.slot, "slot.json"), "utf8")))).toBe(true);
      const { headered, view } = c.make(written.consumer);
      expect(candidateHeaderOf(c.name, headered)).toMatchObject({ schema: "clossys.candidate/1", id: `${c.agent}/${c.slot}/${c.name}` });
      expect(candidateHeaderOf(c.name, view)).toBeUndefined();

      for (const world of [written, control]) write(candidateFile(world.consumer, c.agent, c.twin.slot, c.twin.name), view);
      write(candidateFile(written.consumer, c.agent, c.slot, c.name), headered);
      write(join(control.consumer, "agents", c.agent, c.slot, "slot.json"), jsonBytes(slotV1(control.consumer, c.agent, c.slot)));
      write(candidateFile(control.consumer, c.agent, c.slot, c.name), view);

      const before = rowsByRule(written.root, written.consumer, c);
      const after = rowsByRule(control.root, control.consumer, c);
      // The headered file and its int2 twin in another slot are one content (R06.6), whatever the header says.
      expect(before.R06 ?? []).toContainEqual(expect.stringMatching(/^R06\.6 .*identical content/));
      for (const check of c.expect) expect(Object.values(before).flat()).toContainEqual(expect.stringMatching(new RegExp(`^${check.replace(".", "\\.")} `)));
      const rules = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(id => !HEADER_RULES.includes(id)).sort();
      for (const id of rules) expect(before[id] ?? [], `${c.world} ${id}`).toEqual(after[id] ?? []);
    }, 300_000);
  }
});
