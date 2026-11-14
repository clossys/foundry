/**
 * Test fixture: writes a small workspace (`<root>/clossys/agents/<agent>/...`) from a plain spec and
 * builds the constitution context over it. Every rule test starts from `cleanSpec()`, which passes
 * every implemented check, and breaks exactly one thing.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildContext } from "../context.js";
import type { CandidateHistory, Check, ConstitutionContext, Row } from "../types.js";

export type Agent = "director" | "designer" | "writer" | "publisher" | "producer";

export interface SlotSpec {
  /** Placed in ia.json (default true). */
  live?: boolean;
  /** slot.json content; false writes none. Default {id, agent, kind, inputs: [], uses: []}. */
  slot?: Record<string, unknown> | false;
  /** pin.json: "auto" pins the first candidate validly, false writes none, an object is written as is. */
  pin?: "auto" | false | Record<string, unknown>;
  /** candidates/<name> → text or JSON value. */
  candidates?: Record<string, unknown>;
  /** retired/<name> → text or JSON value. */
  retired?: Record<string, unknown>;
  ledger?: unknown;
  /** Extra files in the slot folder. */
  files?: Record<string, unknown>;
}

export type WorkspaceSpec = Partial<Record<Agent, Record<string, SlotSpec>>>;

export interface FixtureExtras {
  /** agents/<agent>/retired/<name> records. */
  agentRetired?: Partial<Record<Agent, Record<string, unknown>>>;
  /** Root package-lock.json; default locks react@19.0.0. */
  lock?: unknown;
}

const KIND: Record<Agent, string | undefined> = { director: "brief", designer: "element", writer: "strings", publisher: "page", producer: undefined };

export const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const body = (value: unknown) => (typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
const write = (path: string, value: unknown) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body(value)); };

export const AT = "2026-11-13T00:00:00Z";
export function validPin(candidate: string, text: string): Record<string, unknown> {
  return { candidate, sha256: sha(text), decidedBy: "planner", basis: "planner", at: AT };
}

export function slotDoc(agent: Agent, id: string, deps: { inputs?: string[]; uses?: string[] } = {}): Record<string, unknown> {
  return { id, agent, ...(KIND[agent] ? { kind: KIND[agent] } : {}), inputs: deps.inputs ?? [], uses: deps.uses ?? [] };
}

/** A workspace that passes every implemented check: one live slot per agent, each pinned. */
export function cleanSpec(): WorkspaceSpec {
  return {
    director: { "brand.voice": { candidates: { "voice-v1.md": "---\nsource:\n  kind: authored\n---\nCalm and plain.\n" } } },
    designer: {
      "ui.button": { candidates: { "button-v1.json": { name: "button", type: "registry:ui", files: [{ path: "ui/button.tsx", type: "registry:ui", content: "export const Button = 1;\n" }] } } },
      "ui.card": {
        slot: slotDoc("designer", "ui.card", { uses: ["ui.button"] }),
        candidates: { "card-v1.json": { name: "card", type: "registry:ui", dependencies: ["react@19.0.0"], files: [{ path: "ui/card.tsx", type: "registry:ui", content: "import { Button } from \"@/components/ui/button\";\nexport const Card = Button;\n" }] } },
      },
    },
    writer: { "home.hero": { slot: slotDoc("writer", "home.hero", { inputs: ["brand.voice"] }), candidates: { "hero-v1.md": "---\nsource:\n  kind: authored\n---\nWelcome.\n" } } },
    publisher: { "site.home": { slot: slotDoc("publisher", "site.home", { inputs: ["ui.card", "home.hero"] }), candidates: { "home-v1.json": { schema: "clossys.page/1", sections: ["ui.card"], copy: { title: "home.hero#title" } } } } },
    producer: { director: { slot: false, candidates: { "director-v1.json": { seat: "director" } } } },
  };
}

/** Writes the spec under a fresh temp root; returns the root and consumer folder. */
export function writeWorkspace(spec: WorkspaceSpec, extras: FixtureExtras = {}): { root: string; consumer: string } {
  const root = mkdtempSync(join(tmpdir(), "constitution-"));
  const consumer = join(root, "clossys");
  write(join(root, "package-lock.json"), extras.lock ?? { lockfileVersion: 3, packages: { "": {}, "node_modules/react": { version: "19.0.0" } } });
  for (const agent of ["director", "designer", "writer", "publisher", "producer"] as const) {
    const slots = spec[agent] ?? {};
    const agentAbs = join(consumer, "agents", agent);
    mkdirSync(agentAbs, { recursive: true });
    const live = Object.entries(slots).filter(([, slot]) => slot.live !== false).map(([id]) => id);
    write(join(agentAbs, "ia.json"), { nodes: [{ id: "root", children: [{ id: "all", slots: live }] }] });
    for (const [name, value] of Object.entries(extras.agentRetired?.[agent] ?? {})) write(join(agentAbs, "retired", name), value);
    for (const [id, slot] of Object.entries(slots)) {
      const dir = join(agentAbs, id);
      mkdirSync(dir, { recursive: true });
      if (slot.slot !== false) write(join(dir, "slot.json"), slot.slot ?? slotDoc(agent, id));
      const candidates = Object.entries(slot.candidates ?? {});
      for (const [name, value] of candidates) write(join(dir, "candidates", name), value);
      const pin = slot.pin ?? "auto";
      if (pin === "auto" && candidates.length) write(join(dir, "pin.json"), validPin(candidates[0]![0], body(candidates[0]![1])));
      else if (pin !== "auto" && pin !== false) write(join(dir, "pin.json"), pin);
      for (const [name, value] of Object.entries(slot.retired ?? {})) write(join(dir, "retired", name), value);
      if (slot.ledger !== undefined) write(join(dir, "ledger.json"), slot.ledger);
      for (const [name, value] of Object.entries(slot.files ?? {})) write(join(dir, name), value);
    }
  }
  return { root, consumer };
}

export const NO_HISTORY: CandidateHistory = { available: true, changes: new Map(), dirty: new Set() };

/** The context over a written spec; history defaults to a clean one (every file unchanged). */
export function contextOf(spec: WorkspaceSpec, extras: FixtureExtras = {}, history: CandidateHistory = NO_HISTORY): ConstitutionContext {
  const { root, consumer } = writeWorkspace(spec, extras);
  return buildContext(root, consumer, { history: () => history });
}

/**
 * The failing-first contract every implemented check is held to: silent on the clean workspace,
 * at least one row on the broken one. A disabled check (`() => []`) fails the second half, which
 * the suite proves once per check in constitution.test.ts (the in-test mutation).
 */
export function expectCatches(check: Check, clean: ConstitutionContext, broken: ConstitutionContext): Row[] {
  const before = check(clean);
  if (before.length) throw new Error(`check flags the clean workspace: ${JSON.stringify(before[0])}`);
  const after = check(broken);
  if (!after.length) throw new Error("check is silent on the broken workspace");
  return after;
}
