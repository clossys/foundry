/**
 * The P2 critic's two verbs (slot-constitution.md section 5b, stage 4; R16.2):
 *
 *   clossys critique-packet <agent>/<slot> --standard <id> --render <path>... [--exemplar <ref>]... [--seed <text>] [--root <dir>] [--json]
 *   clossys critique <agent>/<slot> --record <file> --model <id> --tier low|mid|high [--candidate <name>] [--at <iso>] [--root <dir>] [--json]
 *
 * `critique-packet` writes nothing: it lists what a fresh critic may see, a closed manifest of the
 * standard's taste.md, at most 3 exemplars, the slot contract and the renders, the renders
 * anonymised (labels A, B, ...) and shuffled by a stable order of their bytes, so neither the maker
 * nor the direction order reaches the critic. A maker file (recipe, direction notes, brief, ledger,
 * prompt) is refused. `critique --record` writes the critic's record to
 * `critiques/<leaf>-v<n>.json` with its `craft:critique` event (records/slot-write.ts), refused
 * unless the record validates against critique.schema.json, names this slot and lists only what
 * R16.2 allows, and unless critique is the craft run's next stage.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { critiqueRecordIssues, manifestIssues } from "../records/critique-record.js";
import { packagePath } from "../package-path.js";
import { SEAT_AGENT, SLOT_AGENTS, SLOT_ID, seatStepOf, type ModelAgent } from "../records/slot-model/index.js";
import { readModelBytes, readSlotEntry } from "../records/slots.js";
import { writeCritique } from "../records/slot-write.js";
import { TIERS } from "../records/ledger.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

export const CRITIQUE_PACKET_USAGE = "Usage: clossys critique-packet <agent>/<slot> --standard <id> --render <path>... [--exemplar <ref>]... [--root <dir>] [--json]\n"
  + "  Lists the blind critic's packet (R16.2): the standard's taste.md, at most 3 exemplars, the slot contract and the\n"
  + "  renders, anonymised and shuffled. Writes nothing; refuses a recipe, direction notes, a brief or anything of the maker.";
export const CRITIQUE_USAGE = "Usage: clossys critique <agent>/<slot> --record <file> --model <id> --tier low|mid|high [--candidate <name>] [--at <iso>] [--root <dir>] [--json]\n"
  + "  Records the critic's critiques/<leaf>-v<n>.json and its craft:critique event; the record validates against\n"
  + "  critique.schema.json and its packet manifest lists only the standard, the contract and the render (R16.2).\n"
  + "  The packet manifest must hash: taste.md (packages/<agent>/standards/<id>/taste.md), up to 3 exemplars, the contract\n"
  + "  (<slotDir>/slot.json#contract, the sha256 of the slot.json bytes) and each render. clossys critique-packet prints\n"
  + "  them (role, ref, sha256), so the critic never opens package files. The record is named after the candidate the\n"
  + "  open run submits (<stem>-v<n>, the next version); any other name is refused by name.";

/** The most exemplars a packet carries (section 5b: the 3 nearest). */
export const PACKET_EXEMPLARS = 3;
const STANDARD_ID = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/;

interface Flags { positional: string[]; values: Map<string, string[]>; help: boolean; json: boolean }
function parse(argv: readonly string[], valued: readonly string[], usage: string): Flags {
  const flags: Flags = { positional: [], values: new Map(), help: false, json: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--json") flags.json = true;
    else if (valued.includes(arg)) {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new CliUsageError(`${arg} needs a value\n${usage}`);
      flags.values.set(arg, [...(flags.values.get(arg) ?? []), value]);
    } else if (arg.startsWith("--")) throw new CliUsageError(`Unknown option: ${arg}\n${usage}`);
    else flags.positional.push(arg);
  }
  return flags;
}
const one = (flags: Flags, flag: string, usage: string): string | undefined => {
  const values = flags.values.get(flag);
  if (values && values.length > 1) throw new CliUsageError(`${flag} is given once\n${usage}`);
  return values?.[0];
};
/** `<agent>/<slot>` of a slot agent, or `producer/seat.<step>`: a Producer seat slot is critiqued like any slot. */
function target(flags: Flags, verb: string, usage: string): { agent: ModelAgent; slot: string } {
  const [given, ...extra] = flags.positional;
  if (!given || extra.length) throw new CliUsageError(`${verb} takes one <agent>/<slot>\n${usage}`);
  const slash = given.indexOf("/");
  const agent = given.slice(0, slash) as ModelAgent, slot = given.slice(slash + 1);
  const known = (SLOT_AGENTS as readonly string[]).includes(agent) || (agent === SEAT_AGENT && seatStepOf(slot) !== undefined);
  if (slash < 1 || !known || !SLOT_ID.test(slot)) throw new CliUsageError(`${verb} target must be <agent>/<slot> or producer/seat.<step>, got ${given}\n${usage}`);
  return { agent, slot };
}
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const refused = (verb: string, message: string): CliResult => ({ exitCode: 1, message: `${verb} refused: ${message}` });
const posixRelative = (root: string, path: string) => relative(root, path).split("\\").join("/");

/** The package ref of a standard folder (`packages/<agent>/standards/<id>`), as packets and records cite it. */
export const standardRef = (agent: string, standard: string): string => `packages/${agent}/standards/${standard}`;

/**
 * Where critique-packet reads a standard's taste.md for `root`: the workspace's own packages/ folder when it
 * has one (the Foundry repository, a test world), else the installed @clossys/<agent> package (a consumer).
 */
export const standardTastePath = (root: string, agent: string, standard: string): string => packagePath(root, `${standardRef(agent, standard)}/taste.md`);

/** One packet item: what the critic sees under `label` (renders) or `role`. */
export interface PacketItem { readonly role: "taste" | "exemplar" | "contract" | "render"; readonly ref: string; readonly sha256?: string; readonly label?: string }

export async function runCritiquePacketCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const usage = CRITIQUE_PACKET_USAGE;
  const flags = parse(argv, ["--standard", "--render", "--exemplar", "--root"], usage);
  if (flags.help) return { exitCode: 0, message: usage };
  const { agent, slot } = target(flags, "critique-packet", usage);
  const standard = one(flags, "--standard", usage);
  if (!standard || !STANDARD_ID.test(standard)) throw new CliUsageError(`critique-packet needs --standard <id>\n${usage}`);
  const renders = flags.values.get("--render") ?? [];
  if (!renders.length) throw new CliUsageError(`critique-packet needs at least one --render <path>\n${usage}`);
  const root = discoverRoot(resolve(cwd, one(flags, "--root", usage) ?? ".")), consumer = join(root, "clossys");
  const entry = readSlotEntry(consumer, agent, slot);
  if (!entry) return refused("critique-packet", `unknown slot ${agent}/${slot} (not in ${agent} ia.json)`);
  const slotDir = posixRelative(root, entry.dir);
  // The packet cites the standard by its package ref; the bytes come from wherever that ref resolves
  // for this root: the workspace's own packages/ folder, else the installed @clossys/<agent> package.
  const base = standardRef(agent, standard);
  const taste = standardTastePath(root, agent, standard);
  if (!existsSync(taste)) return refused("critique-packet", `${base}/taste.md is missing: a packet carries the standard's taste`);
  const given = flags.values.get("--exemplar") ?? [];
  const folder = packagePath(root, `${base}/exemplars`);
  const exemplars = given.length ? given : existsSync(folder) ? readdirSync(folder).sort().map(name => `${base}/exemplars/${name}`) : [];
  if (exemplars.length > PACKET_EXEMPLARS && given.length) return refused("critique-packet", `${given.length} exemplars; a packet carries at most ${PACKET_EXEMPLARS}`);
  const items: PacketItem[] = [
    { role: "taste", ref: `${base}/taste.md`, sha256: sha(readFileSync(taste)) },
    ...exemplars.slice(0, PACKET_EXEMPLARS).map(ref => ({ role: "exemplar" as const, ref, ...(/^https?:\/\//.test(ref) || !existsSync(packagePath(root, ref)) ? {} : { sha256: sha(readFileSync(packagePath(root, ref))) }) })),
    { role: "contract", ref: `${slotDir}/slot.json#contract`, sha256: sha(readModelBytes(join(entry.dir, "slot.json"))) },
  ];
  const seen = new Set<string>();
  const rendered: { ref: string; sha256: string }[] = [];
  for (const path of renders) {
    const absolute = resolve(cwd, path);
    if (!existsSync(absolute)) return refused("critique-packet", `render ${path} does not exist`);
    const ref = posixRelative(root, absolute);
    const digest = sha(readFileSync(absolute));
    if (seen.has(digest)) return refused("critique-packet", `render ${path} has the same bytes as another render`);
    seen.add(digest);
    rendered.push({ ref, sha256: digest });
  }
  // Shuffled by a stable order of the bytes (never the order the maker gave), then labelled A, B, ...
  rendered.sort((a, b) => sha(`${standard}:${a.sha256}`).localeCompare(sha(`${standard}:${b.sha256}`)));
  items.push(...rendered.map((render, index) => ({ role: "render" as const, ref: render.ref, sha256: render.sha256, label: String.fromCharCode(65 + index) })));
  const manifest = items.map(({ role, ref, sha256 }) => ({ role, ref, ...(sha256 ? { sha256 } : {}) }));
  const issues = manifestIssues({ standard, packet: { manifest } }, agent, slotDir);
  if (issues.length) return refused("critique-packet", issues.join("; "));
  const packet = { schema: "clossys.critique-packet/1", slot, standard, items, manifest, sha256: sha(JSON.stringify(manifest)) };
  return {
    exitCode: 0, root, output: packet,
    message: `critique-packet: ${agent}/${slot} against ${standard}: ${items.filter(item => item.role === "render").map(item => item.label).join(", ")} with taste.md, ${Math.min(exemplars.length, PACKET_EXEMPLARS)} exemplar(s) and the contract (sha256 ${packet.sha256.slice(0, 12)})`
      + items.map(item => `\n  ${item.role}${item.label ? ` ${item.label}` : ""} ${item.ref} ${item.sha256 ?? "(no sha256: not a local file)"}`).join(""),
  };
}

export async function runCritiqueCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  const usage = CRITIQUE_USAGE;
  const flags = parse(argv, ["--record", "--model", "--tier", "--candidate", "--at", "--root"], usage);
  if (flags.help) return { exitCode: 0, message: usage };
  const { agent, slot } = target(flags, "critique", usage);
  const file = one(flags, "--record", usage);
  if (!file) throw new CliUsageError(`critique needs --record <file>\n${usage}`);
  const model = one(flags, "--model", usage), tier = one(flags, "--tier", usage);
  if (!model || !tier) throw new CliUsageError(`critique runs an LLM: --model and --tier are required\n${usage}`);
  if (!(TIERS as readonly string[]).includes(tier)) throw new CliUsageError(`--tier must be ${TIERS.join(", ")}, got ${tier}\n${usage}`);
  const at = one(flags, "--at", usage);
  if (at !== undefined && (!/^\d{4}-\d{2}-\d{2}T/.test(at) || Number.isNaN(Date.parse(at)))) throw new CliUsageError(`--at must be an ISO timestamp\n${usage}`);
  const candidate = one(flags, "--candidate", usage);
  const root = discoverRoot(resolve(cwd, one(flags, "--root", usage) ?? ".")), consumer = join(root, "clossys");
  const entry = readSlotEntry(consumer, agent, slot);
  if (!entry) return refused("critique", `unknown slot ${agent}/${slot} (not in ${agent} ia.json)`);
  let record: unknown;
  try { record = JSON.parse(readFileSync(resolve(cwd, file), "utf8")); } catch { return refused("critique", `cannot read ${file} as JSON`); }
  const slotDir = posixRelative(root, entry.dir);
  const validate = (value: unknown): string[] => critiqueRecordIssues(value, { slot, agent, slotDir, ...(candidate !== undefined ? { candidate } : {}) });
  try {
    const named = candidate ?? (record as { candidate?: string } | null)?.candidate;
    const written = writeCritique(consumer, agent, slot, record, { ...(named ? { candidate: named } : {}), ...(at ? { at } : {}), validate }, { model, tier, by: `agent:${agent}.critic` });
    return { exitCode: 0, root, output: { schema: "clossys.critique-recorded/1", slot: `${agent}/${slot}`, file: written.file, event: written.event }, message: `critique: ${agent}/${slot} ${written.file} recorded (craft:critique by ${model}, ${tier})` };
  } catch (error) { return refused("critique", error instanceof Error ? error.message : String(error)); }
}
