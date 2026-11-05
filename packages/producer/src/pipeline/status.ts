import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { STEPS, CHECKS } from "./steps/index.js";
import type { OpenCounter, Port, Step } from "./define.js";
import { globRegex, parseGlob, staticPrefix } from "./globs.js";
import { PACKAGE_ROOT } from "./options.js";
import { readSeats } from "./seats.js";
import { isModelDir, listModelDir, modelExists, readModelText } from "../records/slots.js";
import { FOLDER_KIND } from "../records/slot-model/types.js";
import type { SeatReport } from "./seats.js";

/**
 * `clossys pipeline status`: read-only, from real files only. It runs no step and no check, so a
 * check is reported `not-run` and a pending step `pending`; neither is ever reported as passing.
 */
export const STATUS_SCHEMA = "clossys.pipeline-status/1";

export interface PortStatus { readonly files: number | null; readonly sha256: string | null }
export interface StepStatus {
  readonly id: string; readonly kind: Step["kind"]; readonly actor: string;
  readonly state: "pending" | "ready";
  readonly pending?: Step["pending"];
  readonly inputs: PortStatus; readonly outputs: PortStatus;
  /** The newest output file's modification time; null when the step has no output files here. */
  readonly lastRun: string | null;
  readonly checks: readonly { readonly id: string; readonly state: "pending" | "not-run" }[];
  readonly seat?: SeatReport["state"];
  readonly open?: { readonly counter: OpenCounter; readonly count: number };
}
export interface SlotCounts { readonly slots: number; readonly candidates: number; readonly pinned: number; readonly notNeeded: number; readonly open: number }
export interface SlotRow { readonly slot: string; readonly candidates: number; readonly pinned: boolean; readonly notNeeded: boolean }
export interface PipelineStatus {
  readonly schema: typeof STATUS_SCHEMA;
  readonly steps: readonly StepStatus[];
  readonly agents: Readonly<Record<string, SlotCounts & { readonly bySlot: readonly SlotRow[] }>>;
  readonly open: number;
}

const SKIP = new Set(["node_modules", ".git", ".next", ".turbo"]);
function walk(dir: string, rel: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name), next = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(path, next, out);
    else if (entry.isFile()) out.push(next);
  }
}

class Files {
  private readonly listed = new Map<string, string[]>();
  constructor(private readonly root: string, private readonly packageRoot: string) {}
  /** Files matching one port, as [absolute, display] pairs; null for caller-chosen or cache paths. */
  match(port: Port): [string, string][] | null {
    if (port.glob.startsWith("arg:")) return null;
    const pkg = port.glob.startsWith("pkg:");
    const { path } = parseGlob(pkg ? port.glob.slice(4) : port.glob, "");
    if (path.startsWith("node_modules/")) return null;
    const base = pkg ? this.packageRoot : this.root;
    const prefix = staticPrefix(path);
    const key = `${base}\0${prefix}`;
    let files = this.listed.get(key);
    if (!files) { files = []; walk(join(base, prefix), prefix, files); files.sort(); this.listed.set(key, files); }
    const re = globRegex(path);
    return files.filter(file => re.test(file)).map(file => [join(base, file), pkg ? `pkg:${file}` : file]);
  }
}

function portStatus(files: Files, ports: readonly Port[]): PortStatus & { paths: string[] } {
  const matched = new Map<string, string>();
  let scanned = false;
  for (const port of ports) { const hits = files.match(port); if (hits) { scanned = true; for (const [abs, shown] of hits) matched.set(shown, abs); } }
  if (!scanned) return { files: null, sha256: null, paths: [] };
  const hash = createHash("sha256");
  for (const shown of [...matched.keys()].sort()) hash.update(`${shown}\0${createHash("sha256").update(readFileSync(matched.get(shown)!)).digest("hex")}\n`);
  return { files: matched.size, sha256: matched.size ? hash.digest("hex") : null, paths: [...matched.values()] };
}

const readJson = (file: string): unknown => { try { return JSON.parse(readModelText(file)); } catch { return undefined; } };

/** Per agent, per slot: candidate files, pin, not-needed (slot.json notNeeded), open (neither). */
export function slotCounts(root: string): PipelineStatus["agents"] {
  const agents: Record<string, SlotCounts & { bySlot: SlotRow[] }> = {};
  const dir = join(root, "clossys", "agents");
  if (!modelExists(dir)) return agents;
  for (const agent of listModelDir(dir).sort()) {
    const agentDir = join(dir, agent);
    if (!isModelDir(agentDir)) continue;
    const bySlot: SlotRow[] = [];
    for (const slot of listModelDir(agentDir).sort()) {
      const slotDir = join(agentDir, slot);
      if (!modelExists(join(slotDir, "slot.json"))) continue;
      const doc = readJson(join(slotDir, "slot.json")) as { notNeeded?: unknown } | undefined;
      const candidates = listModelDir(join(slotDir, "candidates")).filter(name => !name.startsWith(".")).length;
      bySlot.push({ slot, candidates, pinned: modelExists(join(slotDir, "pin.json")), notNeeded: Boolean(doc?.notNeeded) });
    }
    if (!bySlot.length) continue;
    agents[agent] = {
      slots: bySlot.length, candidates: bySlot.reduce((sum, row) => sum + row.candidates, 0),
      pinned: bySlot.filter(row => row.pinned).length, notNeeded: bySlot.filter(row => row.notNeeded).length,
      open: bySlot.filter(row => !row.pinned && !row.notNeeded).length, bySlot,
    };
  }
  return agents;
}

function iaSlots(root: string, agent: string): string[] {
  const ia = readJson(join(root, "clossys", "agents", agent, "ia.json")) as { nodes?: { children?: { slots?: unknown[] }[] }[] } | undefined;
  return (ia?.nodes ?? []).flatMap(node => (node.children ?? []).flatMap(child => (child.slots ?? []).filter((slot): slot is string => typeof slot === "string")));
}

function writerKeysUnapproved(root: string): number {
  const dir = join(root, "clossys", "agents", "writer");
  if (!modelExists(dir)) return 0;
  let count = 0;
  for (const slot of listModelDir(dir)) {
    const candidates = join(dir, slot, "candidates");
    for (const name of listModelDir(candidates).filter(name => name.endsWith(".md"))) {
      for (const match of readModelText(join(candidates, name)).matchAll(/^<!-- (\{.*\}) -->$/gm)) {
        let meta: { record?: { status?: unknown }; status?: unknown } | undefined;
        try { meta = JSON.parse(match[1]!); } catch { meta = undefined; }
        const status = meta?.record?.status ?? meta?.status;
        if (status !== "approved") count++;
      }
    }
  }
  return count;
}

function openCount(counter: OpenCounter, root: string, agents: PipelineStatus["agents"], seats: Record<string, SeatReport>): number {
  if (counter.startsWith("slots-undecided:")) return agents[counter.slice("slots-undecided:".length)]?.open ?? 0;
  if (counter === "writer-keys-unapproved") return writerKeysUnapproved(root);
  if (counter === "seats-open") return Object.values(seats).filter(seat => seat.state !== "assigned").length;
  if (counter === "slots-without-slot-json") {
    const dir = join(root, "clossys", "agents");
    if (!modelExists(dir)) return 0;
    // The seat tree's ia.json places seats, which have no slot.json (slot-model FOLDER_KIND).
    return listModelDir(dir).filter(agent => (FOLDER_KIND as Readonly<Record<string, string>>)[agent] !== "seat").reduce((sum, agent) => sum + iaSlots(root, agent).filter(slot => !modelExists(join(dir, agent, slot, "slot.json"))).length, 0);
  }
  const agent = counter.slice("slots-without-candidates:".length);
  return (agents[agent]?.bySlot ?? []).filter(row => row.candidates === 0).length;
}

export function pipelineStatus(root: string, steps: readonly Step[] = STEPS, packageRoot = PACKAGE_ROOT): PipelineStatus {
  const files = new Files(root, packageRoot);
  const agents = slotCounts(root);
  const seats = readSeats(root, steps);
  const pendingChecks = new Set(CHECKS.filter(check => check.pending).map(check => check.id));
  let open = 0;
  const rows = steps.map((step): StepStatus => {
    const inputs = portStatus(files, step.inputs), outputs = portStatus(files, step.outputs);
    const times = outputs.paths.map(path => statSync(path).mtimeMs);
    const count = step.open ? openCount(step.open, root, agents, seats) : undefined;
    if (count) open += count;
    return {
      id: step.id, kind: step.kind, actor: step.actor, state: step.pending?.change === "adds" ? "pending" : "ready",
      ...(step.pending ? { pending: step.pending } : {}),
      inputs: { files: inputs.files, sha256: inputs.sha256 }, outputs: { files: outputs.files, sha256: outputs.sha256 },
      lastRun: times.length ? new Date(Math.max(...times)).toISOString() : null,
      checks: step.checks.map(id => ({ id, state: pendingChecks.has(id) ? "pending" as const : "not-run" as const })),
      ...(seats[step.id] ? { seat: seats[step.id]!.state } : {}),
      ...(step.open ? { open: { counter: step.open, count: count ?? 0 } } : {}),
    };
  });
  return { schema: STATUS_SCHEMA, steps: rows, agents, open };
}
