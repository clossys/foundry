/**
 * Temp workspaces for the slot/2 tests (ticket foundry-build-0010), built only from the existing fixtures,
 * copied as-is (owner rule 2026-11-15: no invented fixture content):
 *
 * - `tallyhouseWorld()`: a temp copy of `test-fixtures/tallyhouse` (frozen) plus the minimum structural records it
 *   lacks to run `clossys ia sync`: `clossys/clossys.config.ts` (copied from `test-fixtures/consumer`), and for each
 *   Tallyhouse slot/2 with a base, `packages/<agent>/package.json` (name, the base version) and the package base at
 *   `base.path`, derived from the consumer file by dropping what a consumer adds (`tighten`, `status`, stamps,
 *   `consumedBy` refs). Tallyhouse base shas are illustrative, so the copy starts out of sync.
 * - `consumerCopy()`: a temp copy of `test-fixtures/consumer` (470 slot/1 files).
 *
 * Tests mutate only these copies; the fixtures stay byte-identical.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SLOT_SCHEMA, serializeSlot } from "../slot.js";
import type { AgentId, Slot } from "../types.js";

export const FIXTURES = fileURLToPath(new URL("../../../test-fixtures/", import.meta.url));
export const TALLYHOUSE = join(FIXTURES, "tallyhouse");
export const CONSUMER = join(FIXTURES, "consumer");
/** Timestamps taken from the Tallyhouse fixture. */
export const AT = "2026-11-18T09:31:12Z";
export const LATER = "2026-11-18T11:40:05Z";

export interface Workspace {
  readonly root: string;
  file(agent: AgentId, id: string): string;
  read(agent: AgentId, id: string): Slot;
  text(agent: AgentId, id: string): string;
  /** Writes a consumer slot.json: a slot (canonical bytes) or raw text. */
  write(agent: AgentId, id: string, slot: Slot | string): string;
  /** The package base file for `<agent>/<id>`. */
  baseFile(agent: AgentId, id: string): string;
  /** Writes a package base (canonical bytes) and, when given, the package version. */
  writeBase(slot: Slot, version?: string): string;
}

function workspace(root: string): Workspace {
  const file = (agent: AgentId, id: string): string => join(root, "clossys", "agents", agent, id, "slot.json");
  const baseFile = (agent: AgentId, id: string): string => join(root, "packages", agent, "src", "catalog", "slots", id, "slot.json");
  const put = (path: string, text: string): string => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); return path; };
  return {
    root, file, baseFile,
    read: (agent, id) => JSON.parse(readFileSync(file(agent, id), "utf8")) as Slot,
    text: (agent, id) => readFileSync(file(agent, id), "utf8"),
    write: (agent, id, slot) => put(file(agent, id), typeof slot === "string" ? slot : serializeSlot(slot)),
    writeBase(slot, version) {
      if (version) put(join(root, "packages", slot.agent, "package.json"), `${JSON.stringify({ name: `@clossys/${slot.agent}`, version })}\n`);
      return put(baseFile(slot.agent, slot.id), serializeSlot(slot));
    },
  };
}

/** The package base a consumer slot was copied from: the consumer file without what a consumer adds. */
export function packageBaseOf(slot: Slot): Slot {
  const { updatedAt: _updatedAt, ...rest } = structuredClone(slot);
  return { ...rest, schema: SLOT_SCHEMA, status: "starter", base: null, tighten: [], refs: rest.refs.filter(ref => ref.rel !== "consumedBy") };
}

/** Every slot/2 file in a Tallyhouse copy, as [agent, id]. */
export function slot2Ids(root: string): [AgentId, string][] {
  const out: [AgentId, string][] = [];
  const agents = join(root, "clossys", "agents");
  for (const agent of readdirSync(agents).sort()) {
    if (!existsSync(join(agents, agent)) || agent.includes(".")) continue;
    for (const id of readdirSync(join(agents, agent)).sort()) {
      const file = join(agents, agent, id, "slot.json");
      if (existsSync(file) && (JSON.parse(readFileSync(file, "utf8")) as { schema?: string }).schema === SLOT_SCHEMA) out.push([agent as AgentId, id]);
    }
  }
  return out;
}

export function tallyhouseWorld(): Workspace {
  const root = mkdtempSync(join(tmpdir(), "slot2-tallyhouse-"));
  cpSync(TALLYHOUSE, root, { recursive: true });
  cpSync(join(CONSUMER, "clossys", "clossys.config.ts"), join(root, "clossys", "clossys.config.ts"));
  const ws = workspace(root);
  for (const [agent, id] of slot2Ids(root)) {
    const slot = ws.read(agent, id);
    if (slot.base) ws.writeBase(packageBaseOf(slot), slot.base.version);
  }
  return ws;
}

export function consumerCopy(): Workspace {
  const root = mkdtempSync(join(tmpdir(), "slot2-consumer-"));
  cpSync(CONSUMER, root, { recursive: true });
  return workspace(root);
}
