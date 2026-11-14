/**
 * A synthetic consumer for the citation model (planner D2): a Director slot `brief.need` with two
 * candidates (v1 pinned), a Writer slot `strings.hero` that declares it as an input and cites it, and a
 * Publisher slot `page.home` citing the Writer slot. Citations are written in `form`: slot ids (the
 * model) or the retired versioned form the migration rewrites. Pins are written as `clossys pin` writes
 * them, `at` ordered so the Writer and Publisher pins follow the Director pin.
 */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "../hash.js";
import { jsonBytes, serializeFrontmatter, slotPositions, type IaDoc, type SlotAgent } from "../slot-model/index.js";

export const NEED = "brief.need", HERO = "strings.hero", HOME = "page.home";

export interface CitationConsumer {
  /** The workspace root (holds `clossys/`). */
  readonly root: string;
  /** The consumer (`<root>/clossys`). */
  readonly consumer: string;
  readonly dir: (agent: SlotAgent, id: string) => string;
}

const directorBytes = (direction: string): string =>
  serializeFrontmatter({ slot: NEED, source: { kind: "original", ref: [] }, feeds: [], functions: [] }, `## Direction\n- need: ${direction}\n\n## Because\n- need: Observed.\n\n## Watch\n- need: If churn > 5% each month, then review.\n`);

/** The Writer candidate: cites the Director slot in `source.ref` and in its text; its record-level `directorSources` line anchor stays versioned. */
export const writerBytes = (cite: string): string =>
  serializeFrontmatter({ slot: HERO, source: { kind: "derived", ref: [cite] }, locales: ["en"] },
    `## en\n### hero.title\n<!-- {"id":"hero-title","bindings":[],"directorSources":[{"ref":"director:brief.need@1","line":3}]} -->\nBuilt for the need in ${cite}; ships with react@18.3.1 and npm/x@1.2.3.\n`);

const publisherBytes = (cite: string): string =>
  jsonBytes({ schema: "clossys.page/1", path: "/", title: "hero.title", frame: null, sections: [], copy: {}, meta: { source: { kind: "derived", ref: [cite] } } });

/** The pin `clossys pin` writes for `bytes`. */
export const pinBytes = (candidate: string, bytes: string, at: string, extra: Record<string, unknown> = {}): string =>
  jsonBytes({ candidate, sha256: sha256Hex(bytes), decidedBy: "owner:fixture", basis: "picked", at, ...extra });

export function citationConsumer(form: "slot" | "versioned" = "slot"): CitationConsumer {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "citation-consumer-")));
  const consumer = join(root, "clossys");
  const dir = (agent: SlotAgent, id: string) => join(consumer, "agents", agent, id);
  const slots: { agent: SlotAgent; id: string; kind: string; inputs: string[]; uses: string[] }[] = [
    { agent: "director", id: NEED, kind: "brief", inputs: [], uses: [] },
    { agent: "writer", id: HERO, kind: "strings", inputs: [NEED], uses: [] },
    { agent: "publisher", id: HOME, kind: "page", inputs: [HERO], uses: [] },
  ];
  for (const slot of slots) {
    const ia: IaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [{ id: "examples", label: "Examples", children: [{ id: "group", label: "Group", slots: [slot.id] }] }] };
    mkdirSync(join(dir(slot.agent, slot.id), "candidates"), { recursive: true });
    writeFileSync(join(consumer, "agents", slot.agent, "ia.json"), jsonBytes(ia));
    writeFileSync(join(dir(slot.agent, slot.id), "slot.json"), jsonBytes({
      schema: "clossys.slot/1", id: slot.id, agent: slot.agent, ia: slotPositions(slot.agent, ia).get(slot.id), kind: slot.kind, contract: {}, inputs: slot.inputs, uses: slot.uses,
    }));
  }
  const write = (agent: SlotAgent, id: string, name: string, bytes: string, at?: string, extra?: Record<string, unknown>) => {
    writeFileSync(join(dir(agent, id), "candidates", name), bytes);
    if (at) writeFileSync(join(dir(agent, id), "pin.json"), pinBytes(name, bytes, at, extra));
  };
  const cite = (agent: string, id: string) => form === "slot" ? `${agent}:${id}` : `${agent}:${id}@1`;
  write("director", NEED, "need-v1.md", directorBytes("Teams of 20 lose a day a week to handoffs."), "2026-11-01T00:00:00Z");
  write("director", NEED, "need-v2.md", directorBytes("Teams of 50 lose two days a week to handoffs."));
  write("writer", HERO, "hero-v1.md", writerBytes(cite("director", NEED)), "2026-11-02T00:00:00Z",
    form === "versioned" ? { recited: { at: "2026-11-02T00:00:00Z", cites: { [`director:${NEED}`]: 1 } } } : {});
  write("publisher", HOME, "home-v1.json", publisherBytes(cite("writer", HERO)), "2026-11-03T00:00:00Z");
  return { root, consumer, dir };
}
