/**
 * `clossys migrate recite`: a pointer-only update in place. When an upstream pin moves and a citing
 * record's meaning is unchanged, the record's pin records the upstream versions it now cites
 * (`pin.recited`); the candidate, basis, decider and `at` stay, no candidate is written and no owner
 * question is raised. Readers see the candidate's refs re-addressed (Director `recitedBytes`), and
 * `clossys gaps` counts a recited input as current.
 *
 * Meaning is proved, not assumed: every ref in the candidate that moves (`director:<cell>@N` to the
 * pinned M) must cite a Director cell whose `## Direction` is byte-identical between N and M, and an
 * input the candidate cites without a version (a slot.json input pinned after it) is the citing
 * agent's judgement. Either unproved case needs `--reason` (where the owner's or agent's words say the
 * meaning holds); otherwise it is refused, and a real meaning change goes to the agent's skill as a
 * new candidate.
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
import { candidateVersion } from "../records/pinned.js";
import { CANDIDATE_NAME, SLOT_AGENTS, validatePin, type PinDoc, type PinRecite, type SlotAgent } from "../records/slot-model/index.js";
import { listSlots, readCandidate, readSlot, slotIndex, type SlotEntry } from "../records/slots.js";
import { writeRecite } from "../records/slot-write.js";
import { directionSection } from "./director-refs.js";

export interface ReciteRow {
  readonly item: string;
  /** recited | restored | current | refused */
  readonly outcome: "recited" | "restored" | "current" | "refused";
  readonly detail: string;
  readonly pin?: PinDoc;
}
export interface ReciteOptions {
  readonly items?: readonly string[];
  readonly agent?: SlotAgent;
  readonly by: string;
  readonly reason?: string;
  readonly restore?: string;
  readonly check?: boolean;
  /** The consumer root (`clossys/`'s parent): where `--restore` reads git. */
  readonly root: string;
}

const REF = /(?<![a-z0-9.:-])(?:(director|designer|writer|publisher):)?([a-z0-9][a-z0-9.-]*)@([1-9][0-9]*)(?![0-9])/g;
const withoutNote = (bytes: string) => bytes.replace(/^note: .*\n/m, "");
/** An owner decision: an owner decider or basis, or an agent pick the owner confirmed. */
const ownerDecision = (pin: PinDoc) => /^owner(?::|$)/.test(pin.decidedBy) || pin.basis === "picked" || pin.basis === "bulk" || pin.confirmed !== undefined;

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

    // What the record cites now: every versioned ref in its bytes and every slot.json input, at the upstream pin.
    const cites: Record<string, number> = {};
    const changes: string[] = [], unproved: string[] = [];
    let blocked: string | undefined;
    for (const [key, versions] of textRefs(bytes, entry.agent, index)) {
      const upstream = index.get(key.slice(key.indexOf(":") + 1))!;
      if (!upstream.pin) { blocked = `${key} is not pinned`; break; }
      const to = candidateVersion(upstream.pin.candidate);
      cites[key] = to;
      if (base.recited?.cites[key] === to) continue;
      for (const from of versions) {
        if (from === to) continue;
        changes.push(`${key}@${from} -> @${to}`);
        if (upstream.agent !== "director") { unproved.push(`${key}@${from} -> @${to}`); continue; }
        const name = `${CANDIDATE_NAME.exec(upstream.pin.candidate)![1]!}-v${from}.md`;
        if (!upstream.candidates.includes(name)) { blocked = `${key}@${from} has no candidate ${name}`; break; }
        const before = readCandidate(consumer, upstream.agent, upstream.id, name).bytes;
        const after = readCandidate(consumer, upstream.agent, upstream.id, upstream.pin.candidate).bytes;
        const lines = (text: string, version: number) => (director.slotCandidateCell({ id: upstream.id, version, updated: "", path: name, bytes: text }) as { direction: { line: number }[] }).direction.map(bullet => bullet.line).join(",");
        if (directionSection(before) !== directionSection(after)) unproved.push(`${key}@${from} -> @${to} (Direction changed)`);
        else if (lines(before, from) !== lines(after, to)) unproved.push(`${key}@${from} -> @${to} (Direction lines moved)`);
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
      if (upstream.pin.at > base.at && base.recited?.cites[key] !== to) { changes.push(`${key}@${to}`); unproved.push(`${key} (an unversioned input pinned after this pin)`); }
    }
    if (!restored && !changes.length) { rows.push({ item, outcome: "current", detail: "every citation is current" }); continue; }
    if (unproved.length && !options.reason) { refuse(`meaning not proved for ${unproved.join("; ")}: pass --reason naming where the words that it holds are, or re-draft a new candidate`); continue; }
    if (restored) {
      // The re-pin being undone moved citations only: its candidate is the restored one with refs re-addressed.
      const current = readCandidate(consumer, entry.agent, entry.id, entry.pin.candidate).bytes;
      if (withoutNote(recitedBytes(bytes, entry.agent, { cites })) !== withoutNote(recitedBytes(current, entry.agent, { cites }))) { refuse(`the current pin's ${entry.pin.candidate} is more than a re-cite of ${base.candidate}; it is kept`); continue; }
    }
    const recited: PinRecite = { by: options.by, at: new Date().toISOString(), cites, ...(options.reason ? { reason: options.reason } : {}) };
    const detail = `${restored ? `restored ${base.candidate} (${base.decidedBy}, ${base.basis}) over ${entry.pin.candidate} (${entry.pin.decidedBy.split(" ")[0]}); ` : ""}cites ${Object.entries(cites).map(([key, version]) => `${key}@${version}`).join(", ")}`;
    if (options.check) { rows.push({ item, outcome: restored ? "restored" : "recited", detail }); continue; }
    const pin = writeRecite(consumer, entry.agent, entry.id, { recited, ...(restored ? { base } : {}) });
    rows.push({ item, outcome: restored ? "restored" : "recited", detail, pin });
  }
  return rows;
}
