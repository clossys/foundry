/**
 * A temp workspace for the slot/2 tests (ticket foundry-build-0010): a consumer root with
 * `clossys/clossys.config.ts`, a `packages/<agent>/` tree that `packagePath` reads as the installed package
 * (a root with `packages/` reads locally), and helpers to write package bases, consumer slots and the
 * Publisher IA. Every root is fresh, under the OS temp dir.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SLOT_SCHEMA, baseSlotPath, serializeSlot } from "../slot.js";
import type { AgentId, Slot } from "../types.js";

export const AT = "2026-11-18T09:12:00Z";
export const LATER = "2026-11-19T10:00:00Z";
export const VERSION = "1.0.0";

export interface Slot2Workspace {
  readonly root: string;
  /** Writes `packages/<agent>/src/catalog/slots/<id>/slot.json` (canonical bytes) and the package.json. */
  base(slot: Slot, version?: string): string;
  /** Writes `clossys/agents/<agent>/<id>/slot.json`: a slot object (canonical bytes) or raw text. */
  consumer(agent: AgentId, id: string, slot: Slot | string): string;
  /** The consumer slot.json path. */
  file(agent: AgentId, id: string): string;
  read(agent: AgentId, id: string): Slot;
  text(agent: AgentId, id: string): string;
  /** Writes `clossys/agents/publisher/ia.json` with one publication. */
  publications(pages: string[], chrome?: string[], release?: string): void;
}

export function slot2Workspace(): Slot2Workspace {
  const root = mkdtempSync(join(tmpdir(), "slot2-"));
  mkdirSync(join(root, "clossys"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
  mkdirSync(join(root, "packages"), { recursive: true });
  const file = (agent: AgentId, id: string): string => join(root, "clossys", "agents", agent, id, "slot.json");
  const put = (path: string, text: string): string => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); return path; };
  return {
    root,
    file,
    base(slot, version = VERSION) {
      put(join(root, "packages", slot.agent, "package.json"), `${JSON.stringify({ name: `@clossys/${slot.agent}`, version })}\n`);
      return put(join(root, "packages", slot.agent, baseSlotPath(slot.id)), serializeSlot(slot));
    },
    consumer: (agent, id, slot) => put(file(agent, id), typeof slot === "string" ? slot : serializeSlot(slot)),
    read: (agent, id) => JSON.parse(readFileSync(file(agent, id), "utf8")) as Slot,
    text: (agent, id) => readFileSync(file(agent, id), "utf8"),
    publications(pages, chrome = [], release) {
      put(join(root, "clossys", "agents", "publisher", "ia.json"), `${JSON.stringify({ publications: { site: { pages, chrome, ...(release ? { release } : {}) } } }, null, 2)}\n`);
    },
  };
}

/** A valid package base slot (what a package ships), with a budget at `contract.copy.fields[heading].maxLength.en`. */
export function baseSlot(agent: AgentId, id: string, over: Partial<Slot> = {}): Slot {
  return {
    schema: SLOT_SCHEMA, id, agent,
    kind: agent === "writer" ? "copy" : agent === "director" ? "brief" : agent === "publisher" ? "page" : agent === "producer" ? "loop" : "element/section",
    status: "starter",
    ia: { l0: "site", l1: "site/home", l2: "site/home/top", order: 1 },
    createdBy: { actor: "package", package: `@clossys/${agent}`, version: VERSION },
    createdAt: AT,
    refs: [],
    base: null,
    standard: "copy.short",
    brief: { purpose: `Say what ${id} is for.`, mustDo: ["Lead with the outcome"], inputs: [], acceptance: [{ check: "copy.length", decider: "code" }] },
    contract: {
      copy: { fields: [{ key: "heading", maxLength: { en: 60 } }, { key: "body", maxLength: { en: 240 } }] },
      tones: ["plain", "warm", "bold"],
      required: ["heading"],
    },
    tighten: [],
    ...over,
  };
}
