/**
 * R06 Package and code dependencies, over every candidate of every slot (live or not, pinned or not):
 * - R06.1 every `dependencies` entry is `<name>@<x.y.z>` and that exact version is in the root lockfile;
 * - R06.2 no vendoring: no file carries CommonJS package source (`module.exports`, `require("…")`), and
 *   no file installs under `lib/<package>/`;
 * - R06.3 `registryDependencies` is empty (links between slots exist only as `uses`);
 * - R06.4 no `source.ref` names another candidate (`<slot>/<candidate>` or `<slot>@<n>`);
 * - R06.5 install paths are unique across slots: the union over all candidates of one slot meets no
 *   other slot's union;
 * - R06.6 no two slots hold a file with identical bytes (embedded registry files and whole candidate files);
 * - R06.7 no candidate (meta.source.ref, source.parts, embedded files and imports: anywhere in its
 *   bytes) and no slot.json `inputs`/`uses` names another slot's candidate file, by path
 *   (`[clossys/]agents/<agent>/<slot>/candidates/<file>`, `../<slot>/candidates/<file>`) or by
 *   shorthand (`<slot>/<name>-v<n>`); a cross-slot reference names the slot id, so it resolves through
 *   that slot's pin. Lineage inside one slot stays allowed (owner rule, foundry-feedback-0017).
 * The byte comparison against installed dependency packages (the second half of R06.2) is pending.
 */
import { sha256Hex } from "../../records/hash.js";
import type { ConstitutionContext, Row, RuleModule, SlotRecord } from "../types.js";
import { allSlots, candidateMeta, installPathOf, isObject, listed, pending, registryFiles, row, stringList } from "./shared.js";

const EXACT_DEPENDENCY = /^((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)@(\d+\.\d+\.\d+)$/;
const CJS = /module\.exports|require\(['"]/;
const CANDIDATE_REF = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3}\/[a-z0-9][a-z0-9.-]*-v[1-9][0-9]*(?:\.(?:md|json))?$/;
const VERSION_REF = /^(?:[a-z]+:)?[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3}@v?[0-9]+$/;

export function exactDependencies(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const slot of allSlots(ctx)) for (const candidate of slot.candidates) {
    const doc = candidate.json;
    if (!isObject(doc) || doc.dependencies === undefined) continue;
    const bad: string[] = [];
    if (!Array.isArray(doc.dependencies)) bad.push("dependencies is not a list");
    else for (const entry of doc.dependencies) {
      const match = typeof entry === "string" ? EXACT_DEPENDENCY.exec(entry) : null;
      if (!match) bad.push(`${String(entry)} is not <name>@<x.y.z>`);
      else if (!ctx.lockVersions?.get(match[1]!)?.has(match[2]!)) bad.push(`${entry} is not in the root package-lock.json`);
    }
    if (bad.length) rows.push(row("R06", "R06.1", slot, `${bad.length} dependenc${bad.length === 1 ? "y" : "ies"} not exact and locked: ${listed(bad, 3)}`, candidate.path, candidate.name));
  }
  return rows;
}

export function vendoring(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const slot of allSlots(ctx)) for (const candidate of slot.candidates) for (const file of registryFiles(candidate)) {
    const installed = installPathOf(file);
    const reasons: string[] = [];
    if (CJS.test(file.content)) reasons.push("carries CommonJS package source (module.exports / require)");
    if (installed && /^lib\/[^/]+\/./.test(installed)) reasons.push(`installs under a package folder (${installed})`);
    if (reasons.length) rows.push(row("R06", "R06.2", slot, `file ${file.path} ${reasons.join(" and ")}`, `${candidate.path}#${file.path}`, candidate.name));
  }
  return rows;
}

export function registryDependencies(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const slot of allSlots(ctx)) for (const candidate of slot.candidates) {
    const doc = candidate.json;
    if (!isObject(doc) || doc.registryDependencies === undefined) continue;
    const list = stringList(doc.registryDependencies);
    if (!Array.isArray(doc.registryDependencies) || doc.registryDependencies.length) {
      rows.push(row("R06", "R06.3", slot, `registryDependencies is not empty (${listed(list, 3)}); link slots through uses`, candidate.path, candidate.name));
    }
  }
  return rows;
}

export function candidateRefs(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const slot of allSlots(ctx)) for (const candidate of slot.candidates) {
    const source = candidateMeta(candidate)?.source;
    if (!isObject(source)) continue;
    const refs = stringList(source.ref).filter(ref => CANDIDATE_REF.test(ref) || VERSION_REF.test(ref));
    if (refs.length) rows.push(row("R06", "R06.4", slot, `source.ref names a candidate or version: ${listed(refs, 3)}`, candidate.path, candidate.name));
  }
  return rows;
}

export function installPaths(ctx: ConstitutionContext): Row[] {
  const owners = new Map<string, Map<string, SlotRecord>>();
  for (const slot of allSlots(ctx)) for (const candidate of slot.candidates) for (const file of registryFiles(candidate)) {
    const path = installPathOf(file);
    if (!path) continue;
    let bySlot = owners.get(path);
    if (!bySlot) owners.set(path, bySlot = new Map());
    bySlot.set(`${slot.agent}/${slot.id}`, slot);
  }
  const rows: Row[] = [];
  for (const [path, bySlot] of [...owners].sort(([a], [b]) => a.localeCompare(b))) {
    if (bySlot.size < 2) continue;
    for (const [key, slot] of bySlot) {
      const others = [...bySlot.keys()].filter(other => other !== key).sort();
      rows.push(row("R06", "R06.5", slot, `install path ${path} is also written by ${listed(others)}`, `${slot.dir}#${path}`));
    }
  }
  return rows;
}

export function identicalBytes(ctx: ConstitutionContext): Row[] {
  const groups = new Map<string, { slot: SlotRecord; where: string; candidate: string }[]>();
  const add = (sha: string, slot: SlotRecord, where: string, candidate: string) => {
    let group = groups.get(sha);
    if (!group) groups.set(sha, group = []);
    group.push({ slot, where, candidate });
  };
  for (const slot of allSlots(ctx)) for (const candidate of slot.candidates) {
    if (candidate.text.length) add(candidate.sha256, slot, candidate.path, candidate.name);
    for (const file of registryFiles(candidate)) if (file.content.length) add(sha256Hex(file.content), slot, `${candidate.path}#${file.path}`, candidate.name);
  }
  const rows: Row[] = [];
  for (const [sha, group] of groups) {
    const slots = new Set(group.map(entry => `${entry.slot.agent}/${entry.slot.id}`));
    if (slots.size < 2) continue;
    for (const entry of group) {
      const key = `${entry.slot.agent}/${entry.slot.id}`;
      const others = [...new Set(group.filter(other => `${other.slot.agent}/${other.slot.id}` !== key).map(other => other.where))].sort();
      rows.push(row("R06", "R06.6", entry.slot, `identical bytes (sha256 ${sha.slice(0, 12)}) also held by ${listed(others, 2)}`, entry.where, entry.candidate));
    }
  }
  return rows;
}

/** A candidate file by path: `[clossys/]agents/<agent>/<slot>/candidates/<file>` or `../<slot>/candidates/<file>`. */
const CANDIDATE_PATH = /(?<![A-Za-z0-9._/-])(?:(?:clossys\/)?agents\/(?:director|designer|writer|publisher|producer)\/|(?:\.\.\/)+)([a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3})\/candidates\/[A-Za-z0-9._-]+/g;
/** A candidate file by shorthand: `<slot>/<name>-v<n>[.md|.json]`. */
const CANDIDATE_SHORTHAND = /(?<![A-Za-z0-9._/@:-])([a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3})\/[a-z0-9][a-z0-9.-]*-v[1-9][0-9]*(?:\.(?:md|json))?(?![A-Za-z0-9_-])/g;

/** The references in `text` to a candidate file of a slot other than `own` (only slots that exist count for shorthand). */
export function foreignCandidateFiles(text: string, own: string, known: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(CANDIDATE_PATH)) if (match[1] !== own) found.add(match[0]);
  for (const match of text.matchAll(CANDIDATE_SHORTHAND)) if (match[1] !== own && known.has(match[1]!)) found.add(match[0]);
  return [...found].sort();
}

export function crossSlotCandidateFiles(ctx: ConstitutionContext): Row[] {
  const known = new Set([...allSlots(ctx)].map(slot => slot.id));
  const rows: Row[] = [];
  const fix = "name the slot id instead, so the reference resolves through that slot's pin";
  for (const slot of allSlots(ctx)) {
    for (const candidate of slot.candidates) {
      const refs = foreignCandidateFiles(candidate.text, slot.id, known);
      if (refs.length) rows.push(row("R06", "R06.7", slot, `references another slot's candidate file: ${listed(refs, 3)}; ${fix}`, candidate.path, candidate.name));
    }
    const doc = slot.slot?.value;
    if (!isObject(doc)) continue;
    const deps = [...stringList(doc.inputs), ...stringList(doc.uses)].flatMap(dep => foreignCandidateFiles(dep, slot.id, known));
    if (deps.length) rows.push(row("R06", "R06.7", slot, `slot.json inputs/uses name a candidate file: ${listed([...new Set(deps)].sort(), 3)}; ${fix}`, slot.slot!.path));
  }
  return rows;
}

export const R06: RuleModule = {
  rule: "R06",
  checks: {
    "R06.1": exactDependencies,
    "R06.2": vendoring,
    "R06.2-installed-bytes": pending("R06", "R06.2-installed-bytes", "unassigned (sweep after W1-A)", "candidate file sha256 equal to a file inside an installed dependency package"),
    "R06.3": registryDependencies,
    "R06.4": candidateRefs,
    "R06.5": installPaths,
    "R06.6": identicalBytes,
    "R06.7": crossSlotCandidateFiles,
  },
};
