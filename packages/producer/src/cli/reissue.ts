/**
 * `clossys reissue`: a deterministic verb (slot-constitution.md section 5, Reissue) that brings one
 * candidate up to the slot rules as the slot's next version, run with the Producer's
 * `actions/reissue/skill.md`.
 *
 *   clossys reissue <agent>/<slot> <candidate> --by agent:<seat> [--at <iso>] [--root <dir>] [--json]
 *
 * The next version is named for the slot's leaf (`components.button` -> `button-v<n>`). A JSON
 * candidate's `dependencies` become exact `<name>@<x.y.z>` from the root package-lock.json, its
 * `registryDependencies` move to slot.json `uses` (as slot ids of the same agent) and are emptied,
 * and its preview props are dropped (the fixture belongs to slot.json `contract.fixture`). In every
 * candidate the line anchors left after the citations codemod move to slot ids (D3b). The submit
 * records rung adopt (the Designer's L1 or L2) with seed `<slot>/<old>@<sha>`; the old file is
 * retired (`superseded`, or `edited-in-place` when its bytes are not the ones the ledger recorded);
 * a pinned old file is repinned with the same basis and decidedBy plus `reissue: true`, so owner
 * approvals carry over. The reissue guard (every check whose rules.json guard lists reissue) runs on
 * what the write leaves and refuses, undoing everything, on any finding.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { lockfileVersions } from "../constitution/context.js";
import { lineAnchorsToSlots, slotOwner } from "../records/citations.js";
import { CANDIDATE_NAME, KIND_EXT, MODEL_AGENTS, SLOT_ID, type ModelAgent } from "../records/slot-model/index.js";
import { readCandidate, readLedger, readSlot, readSlotEntry, slotIndex, type SlotEntry } from "../records/slots.js";
import { GuardRefusal, writeReissue, type WriteGuard } from "../records/slot-write.js";
import "../constitution/guard.js"; // registers the write guard's runner
import { DESIGNER_RUNG_KIND } from "../pipeline/candidate-ladder.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { isOldTargetSlot, oldSlotRefusal, resolveCandidate } from "./pin.js";
import { seatRefusal } from "../records/seat-owner.js";
import { discoverRoot } from "./root.js";
import { candidateCodec, recutCandidateBytes } from "../records/candidate-codec.js";
import { candidateHeaderOf } from "../records/slot-current.js";
import { cliActor, toIsoZ } from "../records/pin.js";

export const REISSUE_USAGE = "Usage: clossys reissue <agent>/<slot> <candidate> --by agent:<seat> [--at <iso timestamp>] [--root <dir>] [--json]\n"
  + "  Writes the slot's next version <leaf>-v<n> of <candidate>: exact dependencies from the root package-lock.json,\n"
  + "  registryDependencies moved to slot.json uses, preview props dropped, line anchors moved to slot ids.\n"
  + "  Records rung adopt (the Designer's L1 or L2) with seed <slot>/<candidate>@<sha256>, retires <candidate>\n"
  + "  (superseded, or edited-in-place) and repins it when pinned (same basis and decidedBy, reissue: true).\n"
  + "  Refuses on any finding of a constitution check whose rules.json guard lists reissue.";

const EXACT = /^((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)@(\d+\.\d+\.\d+)$/;
const NAME = /^((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)(?:@(.+))?$/;
const SEAT = /^agent:\S+$/;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => value !== null && typeof value === "object" && !Array.isArray(value);

/** The workspace lockfile's packages: every locked version by name, and the root-installed version. */
export interface Lock { readonly versions: ReadonlyMap<string, ReadonlySet<string>>; readonly root: ReadonlyMap<string, string> }
export function readLock(workspace: string): Lock {
  let value: unknown;
  try { value = JSON.parse(readFileSync(join(workspace, "package-lock.json"), "utf8")); }
  catch (error) { throw new Error(`reissue refused: cannot read the root package-lock.json: ${error instanceof Error ? error.message : String(error)}`); }
  const root = new Map<string, string>();
  const packages = (value as { packages?: unknown }).packages;
  if (isObject(packages)) for (const [key, entry] of Object.entries(packages)) {
    if (key.startsWith("node_modules/") && !key.slice("node_modules/".length).includes("node_modules/") && isObject(entry) && typeof entry.version === "string") root.set(key.slice("node_modules/".length), entry.version);
  }
  return { versions: lockfileVersions(value), root };
}

/**
 * Exact dependencies from the lock: an exact locked `<name>@<x.y.z>` stays; any other entry takes the
 * root-installed version of its name, or the one version the lock holds. A name the lock does not
 * hold, or holds at several versions with none at the root, refuses (`issues`).
 */
export function exactDependencies(dependencies: readonly unknown[], lock: Lock): { dependencies: string[]; issues: string[] } {
  const out: string[] = [], issues: string[] = [];
  for (const entry of dependencies) {
    if (typeof entry !== "string") { issues.push(`dependency ${JSON.stringify(entry)} is not a string`); continue; }
    const exact = EXACT.exec(entry);
    if (exact && lock.versions.get(exact[1]!)?.has(exact[2]!)) { out.push(entry); continue; }
    const name = NAME.exec(entry)?.[1];
    const versions = name ? [...(lock.versions.get(name) ?? [])] : [];
    const version = name ? lock.root.get(name) ?? (versions.length === 1 ? versions[0] : undefined) : undefined;
    if (!name || !version) { issues.push(`dependency ${entry} ${!name ? "is not a package name" : versions.length ? `is locked at several versions (${versions.join(", ")}) and none at the root` : "is not in the root package-lock.json"}`); continue; }
    out.push(`${name}@${version}`);
  }
  return { dependencies: [...new Set(out)], issues };
}

/**
 * registryDependencies as slot ids of `agent`: a slot id of the agent, or a registry item name (bare,
 * or the last segment of a URL or path, without `.json`) that is the leaf of exactly one of its slots.
 */
export function registrySlots(entries: readonly unknown[], agent: ModelAgent, index: ReadonlyMap<string, SlotEntry>): { uses: string[]; issues: string[] } {
  const own = [...index.values()].filter(entry => entry.agent === agent);
  const uses: string[] = [], issues: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string" || !entry.trim()) { issues.push(`registryDependency ${JSON.stringify(entry)} is not a name`); continue; }
    const prefixed = /^([a-z]+):(.+)$/.exec(entry);
    if (prefixed && (MODEL_AGENTS as readonly string[]).includes(prefixed[1]!) && prefixed[1] !== agent) { issues.push(`registryDependency ${entry} names another agent's slot`); continue; }
    const cited = prefixed && prefixed[1] === agent ? prefixed[2]! : entry;
    if (SLOT_ID.test(cited)) {
      const found = index.get(cited);
      if (found?.agent === agent) { uses.push(cited); continue; }
      issues.push(`registryDependency ${entry} is not a ${agent} slot`); continue;
    }
    const item = cited.split(/[/\\]/).at(-1)!.replace(/\.json$/, "");
    const matches = own.filter(slot => slot.id.split(".").at(-1) === item);
    if (matches.length === 1) uses.push(matches[0]!.id);
    else issues.push(`registryDependency ${entry} ${matches.length ? `names several ${agent} slots (${matches.map(slot => slot.id).join(", ")})` : `names no ${agent} slot`}`);
  }
  return { uses: [...new Set(uses)], issues };
}

/** A JSON candidate without its preview props (`meta.preview.props`, `meta.preview.fixtures.props`). */
export function withoutPreviewProps(doc: Json): Json {
  const meta = doc.meta;
  if (!isObject(meta) || !isObject(meta.preview)) return doc;
  const { props: _props, ...preview } = meta.preview;
  if (isObject(preview.fixtures)) {
    const { props: _fixtureProps, ...fixtures } = preview.fixtures;
    preview.fixtures = fixtures;
  }
  return { ...doc, meta: { ...meta, preview } };
}

/** The reissue's ladder rung: adopt, or for the Designer the old submit's L1/L2, else L1 for stock shadcn and L2 for a partner registry. */
export function reissueRung(agent: ModelAgent, oldRung: unknown, doc: unknown, headerSource?: unknown): string {
  if (agent !== "designer") return "adopt";
  if (typeof oldRung === "string" && (DESIGNER_RUNG_KIND as Record<string, string>)[oldRung] === "adopt") return oldRung;
  // A headered candidate's source sits in its clossys.candidate/1 header, not in meta.source (U13).
  const source = isObject(doc) && isObject(doc.meta) && isObject(doc.meta.source) ? doc.meta.source : isObject(headerSource) ? headerSource : undefined;
  const refs = Array.isArray(source?.ref) ? source!.ref : typeof source?.ref === "string" ? [source.ref] : [];
  return refs.some(ref => typeof ref === "string" && /^shadcn(?:-aria|@aria)?\//.test(ref)) ? "L1" : "L2";
}

export interface ReissuePlan { readonly content: unknown; readonly uses?: readonly string[]; readonly anchors: number; readonly issues: readonly string[] }
/** The reissued content of one candidate (pure: the lock, the slot index and slot.json uses are its inputs). */
export function planReissue(text: string, json: boolean, input: { agent: ModelAgent; slot: string; uses: readonly string[]; lock: Lock; index: ReadonlyMap<string, SlotEntry> }): ReissuePlan {
  const owner = slotOwner(input.index);
  if (!json) {
    const anchored = lineAnchorsToSlots(text, owner);
    return { content: anchored.text, anchors: anchored.count, issues: [] };
  }
  let doc: unknown;
  try { doc = JSON.parse(text); } catch (error) { return { content: undefined, anchors: 0, issues: [`the candidate is not JSON: ${error instanceof Error ? error.message : String(error)}`] }; }
  if (!isObject(doc)) return { content: undefined, anchors: 0, issues: ["the candidate is not a JSON object"] };
  const issues: string[] = [];
  let next: Json = withoutPreviewProps(doc);
  if (next.dependencies !== undefined) {
    if (!Array.isArray(next.dependencies)) issues.push("dependencies is not a list");
    else { const exact = exactDependencies(next.dependencies, input.lock); issues.push(...exact.issues); next = { ...next, dependencies: exact.dependencies }; }
  }
  let uses: string[] | undefined;
  if (next.registryDependencies !== undefined) {
    if (!Array.isArray(next.registryDependencies)) issues.push("registryDependencies is not a list");
    else {
      const moved = registrySlots(next.registryDependencies, input.agent, input.index);
      issues.push(...moved.issues);
      const added = moved.uses.filter(id => id !== input.slot && !input.uses.includes(id));
      if (added.length) uses = [...input.uses, ...added];
      next = { ...next, registryDependencies: [] };
    }
  }
  const anchored = lineAnchorsToSlots(`${JSON.stringify(next, null, 2)}\n`, owner);
  return { content: JSON.parse(anchored.text), ...(uses ? { uses } : {}), anchors: anchored.count, issues };
}

interface Flags { positional: string[]; by?: string; at?: string; root?: string; help: boolean }
function parse(argv: readonly string[]): Flags {
  const flags: Flags = { positional: [], help: false };
  const value = (index: number, name: string): string => {
    const next = argv[index];
    if (next === undefined || next.startsWith("--")) throw new CliUsageError(`${name} requires a value\n${REISSUE_USAGE}`);
    return next;
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--json") continue;
    else if (arg === "--help") flags.help = true;
    else if (arg === "--by") flags.by = value(++index, "--by");
    else if (arg === "--at") flags.at = value(++index, "--at");
    else if (arg === "--root") flags.root = value(++index, "--root");
    else if (arg.startsWith("--")) throw new CliUsageError(`Unknown argument: ${arg}\n${REISSUE_USAGE}`);
    else flags.positional.push(arg);
  }
  return flags;
}

const refuse = (message: string): CliResult => ({ exitCode: 1, message: /^reissue refused/.test(message) ? message : `reissue refused: ${message}` });

export async function runReissueCli(argv: readonly string[], cwd: string, guard: WriteGuard = true): Promise<CliResult> {
  const flags = parse(argv);
  if (flags.help) return { exitCode: 0, message: REISSUE_USAGE };
  const [target, candidateId, ...extra] = flags.positional;
  if (!target || !candidateId || extra.length) throw new CliUsageError(`reissue takes <agent>/<slot> <candidate>\n${REISSUE_USAGE}`);
  const slash = target.indexOf("/");
  // Every model agent's slots reissue, the Producer's seats included (their candidates are JSON).
  const agent = target.slice(0, slash) as ModelAgent, id = target.slice(slash + 1);
  if (slash < 1 || !(MODEL_AGENTS as readonly string[]).includes(agent) || !SLOT_ID.test(id)) throw new CliUsageError(`reissue target must be <agent>/<slot> with agent ${MODEL_AGENTS.join(", ")} and a slot id, got ${target}\n${REISSUE_USAGE}`);
  if (!flags.by || !SEAT.test(flags.by)) throw new CliUsageError(`reissue is an agent seat's: --by agent:<seat>${flags.by ? `, got ${flags.by}` : ""}\n${REISSUE_USAGE}`);
  const at = flags.at ?? new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(at) || Number.isNaN(Date.parse(at))) throw new CliUsageError(`--at must be an ISO timestamp\n${REISSUE_USAGE}`);
  const root = discoverRoot(resolve(cwd, flags.root ?? ".")), consumer = join(root, "clossys");
  const entry = readSlotEntry(consumer, agent, id);
  if (!entry) return refuse(`unknown slot ${target} (not in ${agent} ia.json)`);
  const old = resolveCandidate(entry.candidates, candidateId);
  if (!old || !CANDIDATE_NAME.test(old)) return refuse(`${target} has no candidate ${candidateId}${entry.candidates.length ? ` (candidates: ${entry.candidates.join(", ")})` : ""}`);
  // One format (foundry-build-0048 U13): a reissue writes a headered candidate in a clossys.slot/2 slot only.
  // The seat rule judges who acts before the format refusal judges what is written (Q9).
  const crossing = seatRefusal(flags.by, agent);
  if (crossing !== undefined) return refuse(crossing);
  if (isOldTargetSlot(root, agent, id)) return refuse(oldSlotRefusal("reissue", target));
  try {
    const doc = readSlot(consumer, agent, id);
    const read = readCandidate(consumer, agent, id, old);
    const lock = readLock(dirname(resolve(consumer)));
    // The one candidate reader (records/slots.ts readCandidate, U37c) gives the file as it is (`raw`). The one candidate
    // codec (U13 r4): a candidate submitted without a clossys header is read as its recut mapping (what migrate slots
    // writes), so the reissue transforms the content and front fields beside the header only.
    const oldText = read.raw;
    const headered = candidateHeaderOf(old, oldText) ? oldText : recutCandidateBytes(old, oldText, { agent, slotId: id, at: toIsoZ(at) ?? at, version: cliActor("clossys reissue").version, sourceRef: `agents/${agent}/${id}/candidates/${old}`, cli: "clossys reissue" } as Parameters<typeof recutCandidateBytes>[2]);
    const split = candidateCodec.parse(old, headered);
    const oldHeader = headered === oldText ? undefined : split.header;
    const plan = planReissue(split.content, KIND_EXT[doc.kind] === "json", { agent, slot: id, uses: doc.uses, lock, index: slotIndex(consumer) });
    if (plan.issues.length) return refuse(`${target} ${old}: ${plan.issues.join("; ")}`);
    const events = (readLedger(entry.dir, "slot")?.events ?? []) as unknown as Record<string, unknown>[];
    const oldRung = events.filter(event => event.op === "submit" && (event.name === old || event.candidate === old)).at(-1)?.rung;
    const rung = reissueRung(agent, oldRung, plan.content, split.header?.source);
    const result = writeReissue(consumer, agent, id, { old, oldSha256: read.sha256, content: plan.content, ...(plan.uses ? { uses: plan.uses } : {}), rung, by: flags.by, at, front: split.front, ...(oldHeader ? { oldHeader: oldHeader as never } : {}) }, { guard });
    return {
      exitCode: 0, root,
      decision: { slot: target, reissued: old, candidate: result.name, sha256: result.sha256, rung, seed: result.seed, retired: result.code, repinned: result.repinned, usesChanged: result.usesChanged, anchors: plan.anchors, by: flags.by, at },
      message: `reissue: ${target} ${old} -> ${result.name} (${result.sha256.slice(0, 12)}), rung ${rung}, ${old} retired ${result.code}${result.repinned ? `, repinned` : ""}${result.usesChanged ? `, uses ${plan.uses!.join(", ")}` : ""}${plan.anchors ? `, ${plan.anchors} line anchor${plan.anchors === 1 ? "" : "s"} moved to slot ids` : ""}`,
    };
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    if (error instanceof GuardRefusal) return { exitCode: 1, message: `reissue refused: ${error.message}`, output: { schema: "clossys.reissue-refused/1", slot: target, verb: error.verb, checks: error.checks, findings: error.findings } };
    return refuse(error instanceof Error ? error.message : String(error));
  }
}
