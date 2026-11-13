/**
 * `clossys migrate recite`: a pointer-only update in place. When an upstream pin moves and a citing
 * record's meaning is unchanged, the record's pin records the upstream versions it now cites
 * (`pin.recited`); the candidate, basis, decider and `at` stay, no candidate is written and no owner
 * question is raised. Readers see the candidate's refs re-addressed (Director `recitedBytes`), and
 * `clossys gaps` counts a recited input as current.
 *
 * Meaning is proved by hash, never by a reason string (meaningHash): a Director cell means its
 * `## Direction` section (and its Direction line numbers must not move); any other candidate means its
 * bytes with the frontmatter `note:` line and every ref's version set aside. A moved ref (`<agent>:<slot>@N`
 * to the pinned M, or from the version `recited.cites` last recorded) is proved when N and M hash the same. An input the candidate cites without a version
 * (a slot.json input pinned after it) is proved against the meaning the record last cited: `recited.proof`,
 * the version `recited.cites` names, or the upstream pin in force at this pin's `at` (its git history).
 * Each recite records `recited.proof` so the next one compares hashes. An unproved citation is a meaning
 * change: refused here, and under `--cascade` (what `clossys run` calls after a pin step) reported
 * `changed`, which opens `<agent>.candidates` for that slot (records/stale-citations.ts).
 *
 * `--restore <rev>` undoes a re-pin that only moved citations: the slot's owner decision at `<rev>` (an
 * owner pin or a confirmed agent pick) is kept instead of the current pin when the current pin is not an
 * owner decision and its candidate equals
 * the restored candidate with the refs re-addressed (a frontmatter `note:` line aside). So an owner
 * pin a cascade re-pinned as `--basis planner` gets its owner basis and decider back.
 */
import { execFileSync } from "node:child_process";
import { relative } from "node:path";
import { recitedBytes } from "@clossys/director";
import { agentModule } from "../server/cells.js";
import { sha256Hex } from "../records/hash.js";
import { candidateVersion } from "../records/pinned.js";
import { SLOT_AGENTS, validatePin, type PinDoc, type PinRecite, type SlotAgent } from "../records/slot-model/index.js";
import { listSlots, readCandidate, readSlot, slotIndex, type SlotEntry } from "../records/slots.js";
import { writeRecite } from "../records/slot-write.js";
import { directionSection } from "./director-refs.js";

export interface ReciteRow {
  readonly item: string;
  /** recited | restored | current | refused; changed (a meaning change, `--cascade` only: candidate work) */
  readonly outcome: "recited" | "restored" | "current" | "refused" | "changed";
  readonly detail: string;
  readonly pin?: PinDoc;
}
export interface ReciteOptions {
  readonly items?: readonly string[];
  readonly agent?: SlotAgent;
  readonly by: string;
  readonly restore?: string;
  /** The runner's cascade: a meaning change is reported `changed` (candidate work), not refused. */
  readonly cascade?: boolean;
  readonly check?: boolean;
  /** The consumer root (`clossys/`'s parent): where `--restore` reads git. */
  readonly root: string;
}

const REF = /(?<![a-z0-9.:-])(?:(director|designer|writer|publisher):)?([a-z0-9][a-z0-9.-]*)@([1-9][0-9]*)(?![0-9])/g;
const withoutNote = (bytes: string) => bytes.replace(/^note: .*\n/m, "");
/** An owner decision: an owner decider or basis, or an agent pick the owner confirmed. */
const ownerDecision = (pin: PinDoc) => /^owner(?::|$)/.test(pin.decidedBy) || pin.basis === "picked" || pin.basis === "bulk" || pin.confirmed !== undefined;

/** What one upstream candidate means, as a hash: a Director cell's Direction; any other candidate's bytes, note and ref versions aside. */
export function meaningHash(agent: SlotAgent, bytes: string): string {
  const meaning = agent === "director" ? directionSection(bytes) : withoutNote(bytes).replace(REF, (_ref, cited: string | undefined, slot: string) => `${cited ? `${cited}:` : ""}${slot}@`);
  return `sha256:${sha256Hex(meaning)}`;
}

/** The versioned refs a candidate's bytes carry: `<agent>:<slot>` to each cited version. */
function textRefs(bytes: string, agent: SlotAgent, index: ReadonlyMap<string, SlotEntry>): Map<string, Set<number>> {
  const refs = new Map<string, Set<number>>();
  for (const match of bytes.matchAll(REF)) {
    const cited = (match[1] as SlotAgent | undefined) ?? agent, slot = match[2]!;
    const upstream = index.get(slot);
    if (!upstream || upstream.agent !== cited) continue;
    const key = `${cited}:${slot}`;
    refs.set(key, new Set([...(refs.get(key) ?? []), Number(match[3])]));
  }
  return refs;
}

/** The slot's pin at a git revision, or why there is none. */
function pinAt(root: string, entry: SlotEntry, rev: string): PinDoc | string {
  const path = relative(root, `${entry.dir}/pin.json`);
  let text: string;
  try { text = execFileSync("git", ["-C", root, "show", `${rev}:./${path}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return `no pin at ${rev}`; }
  let value: unknown;
  try { value = JSON.parse(text); } catch { return `the pin at ${rev} is not JSON`; }
  const issues = validatePin(value);
  return issues.length ? `the pin at ${rev} is invalid: ${issues[0]!.message}` : value as PinDoc;
}

/** The upstream pin in force at `at`: the newest pin in the slot's git history whose own `at` is not later. */
function pinInForce(root: string, entry: SlotEntry, at: string, histories: Map<string, PinDoc[]>): PinDoc | undefined {
  const path = relative(root, `${entry.dir}/pin.json`);
  if (!histories.has(`${root}\0${path}`)) {
    let revs: string[] = [];
    try { revs = execFileSync("git", ["-C", root, "log", "--format=%H", "--", path], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean); }
    catch { revs = []; }
    histories.set(`${root}\0${path}`, revs.flatMap(rev => { const pin = pinAt(root, entry, rev); return typeof pin === "string" ? [] : [pin]; }));
  }
  return histories.get(`${root}\0${path}`)!.find(pin => pin.at <= at);
}

/** Plan (and unless `check`, write) the recite of each targeted pinned slot. */
export async function recite(consumer: string, options: ReciteOptions): Promise<ReciteRow[]> {
  const index = slotIndex(consumer);
  const director = await agentModule("director", "index.js");
  const targets: SlotEntry[] = [];
  if (options.items?.length) {
    for (const item of options.items) {
      const [agent, id] = [item.slice(0, item.indexOf("/")), item.slice(item.indexOf("/") + 1)];
      const entry = index.get(id);
      if (!entry || entry.agent !== agent) throw new Error(`recite: ${item} is not a slot`);
      targets.push(entry);
    }
  } else for (const agent of options.agent ? [options.agent] : SLOT_AGENTS) targets.push(...listSlots(consumer, agent));

  const meanings = new Map<string, string>(), histories = new Map<string, PinDoc[]>();
  const meaningOf = (upstream: SlotEntry, name: string): string => {
    const key = `${upstream.agent}/${upstream.id}/${name}`;
    if (!meanings.has(key)) meanings.set(key, meaningHash(upstream.agent, readCandidate(consumer, upstream.agent, upstream.id, name).bytes));
    return meanings.get(key)!;
  };
  const rows: ReciteRow[] = [];
  for (const entry of targets) {
    const item = `${entry.agent}/${entry.id}`;
    if (!entry.pin) { if (options.items?.length) rows.push({ item, outcome: "refused", detail: "no pin" }); continue; }
    const refuse = (detail: string) => rows.push({ item, outcome: "refused", detail });
    let base = entry.pin;
    let restored = false;
    if (options.restore) {
      const prior = pinAt(options.root, entry, options.restore);
      // Only an owner decision is restored (an owner pin, or an agent pick the owner confirmed), and only over a
      // later pin that is not one: a later owner decision stands.
      // A slot with no pin at <rev> has nothing to restore and is only re-cited.
      if (typeof prior !== "string" && JSON.stringify(prior) !== JSON.stringify(entry.pin) && ownerDecision(prior) && !ownerDecision(entry.pin)) { base = prior; restored = true; }
    }
    let bytes: string;
    try { bytes = readCandidate(consumer, entry.agent, entry.id, base.candidate).bytes; }
    catch { refuse(`candidate ${base.candidate} is missing`); continue; }

    // What the record cites now: every versioned ref in its bytes and every slot.json input, at the upstream
    // pin, with the hash of what each cited version means.
    const cites: Record<string, number> = {}, proof: Record<string, string> = {};
    const changes: string[] = [], unproved: string[] = [];
    let blocked: string | undefined;
    for (const [key, versions] of textRefs(bytes, entry.agent, index)) {
      const upstream = index.get(key.slice(key.indexOf(":") + 1))!;
      if (!upstream.pin) { blocked = `${key} is not pinned`; break; }
      const to = candidateVersion(upstream.pin.candidate);
      cites[key] = to;
      proof[key] = meaningOf(upstream, upstream.pin.candidate);
      // The baseline is the version this record last recited (and the meaning it proved then), not the
      // version its text names: a recited record already moved past its text's refs.
      const last = base.recited?.cites[key];
      if (last === to) continue;
      for (const from of last !== undefined ? [last] : versions) {
        if (from === to) continue;
        changes.push(`${key}@${from} -> @${to}`);
        const name = upstream.candidates.find(each => candidateVersion(each) === from);
        if (!name) { blocked = `${key}@${from} has no candidate`; break; }
        const prior = (last !== undefined ? base.recited?.proof?.[key] : undefined) ?? meaningOf(upstream, name);
        if (prior !== proof[key]) { unproved.push(`${key}@${from} -> @${to} (${upstream.agent === "director" ? "Direction" : "content"} changed)`); continue; }
        if (upstream.agent !== "director") continue;
        const before = readCandidate(consumer, upstream.agent, upstream.id, name).bytes;
        const after = readCandidate(consumer, upstream.agent, upstream.id, upstream.pin.candidate).bytes;
        const lines = (text: string, version: number) => (director.slotCandidateCell({ id: upstream.id, version, updated: "", path: name, bytes: text }) as { direction: { line: number }[] }).direction.map(bullet => bullet.line).join(",");
        if (lines(before, from) !== lines(after, to)) unproved.push(`${key}@${from} -> @${to} (Direction lines moved)`);
      }
      if (blocked) break;
    }
    if (blocked) { refuse(blocked); continue; }
    for (const input of readSlot(consumer, entry.agent, entry.id).inputs) {
      const upstream = index.get(input);
      if (!upstream?.pin) continue;
      const key = `${upstream.agent}:${input}`;
      if (key in cites) continue;
      const to = candidateVersion(upstream.pin.candidate);
      cites[key] = to;
      proof[key] = meaningOf(upstream, upstream.pin.candidate);
      if (!(upstream.pin.at > base.at && base.recited?.cites[key] !== to)) continue;
      changes.push(`${key}@${to}`);
      // The meaning this record last cited: its recorded proof, the version it last recited, or the upstream pin in force when it was pinned.
      const last = base.recited?.cites[key];
      const lastName = last !== undefined ? upstream.candidates.find(each => candidateVersion(each) === last) : pinInForce(options.root, upstream, base.at, histories)?.candidate;
      const prior = base.recited?.proof?.[key] ?? (lastName && upstream.candidates.includes(lastName) ? meaningOf(upstream, lastName) : undefined);
      if (prior === undefined) unproved.push(`${key}@${to} (no recorded meaning to compare: an unversioned input pinned after this pin)`);
      else if (prior !== proof[key]) unproved.push(`${key}@${to} (${upstream.agent === "director" ? "Direction" : "content"} changed)`);
    }
    if (!restored && !changes.length) { rows.push({ item, outcome: "current", detail: "every citation is current" }); continue; }
    if (unproved.length) {
      const detail = `meaning changed for ${unproved.join("; ")}: the ${entry.agent} skill drafts a new candidate`;
      if (options.cascade) rows.push({ item, outcome: "changed", detail }); else refuse(detail);
      continue;
    }
    if (restored) {
      // The re-pin being undone moved citations only: its candidate is the restored one with refs re-addressed.
      const current = readCandidate(consumer, entry.agent, entry.id, entry.pin.candidate).bytes;
      if (withoutNote(recitedBytes(bytes, entry.agent, { cites })) !== withoutNote(recitedBytes(current, entry.agent, { cites }))) { refuse(`the current pin's ${entry.pin.candidate} is more than a re-cite of ${base.candidate}; it is kept`); continue; }
    }
    const recited: PinRecite = { by: options.by, at: new Date().toISOString(), cites, proof };
    const detail = `${restored ? `restored ${base.candidate} (${base.decidedBy}, ${base.basis}) over ${entry.pin.candidate} (${entry.pin.decidedBy.split(" ")[0]}); ` : ""}cites ${Object.entries(cites).map(([key, version]) => `${key}@${version}`).join(", ")}`;
    if (options.check) { rows.push({ item, outcome: restored ? "restored" : "recited", detail }); continue; }
    const pin = writeRecite(consumer, entry.agent, entry.id, { recited, ...(restored ? { base } : {}) });
    rows.push({ item, outcome: restored ? "restored" : "recited", detail, pin });
  }
  return rows;
}
