/**
 * Director check suite `director.cell.v1`. Deterministic and report-only:
 * callers decide whether findings fail a run.
 *
 * D-REQ   every required Direction key is present and filled
 * D-SPEC  Direction values avoid generic filler phrases (Never/Avoid bullets exempt)
 * D-COVER downstream Writer and Designer cells cite the current version
 */
import { parseCell } from "../format/cell.js";
import type { Cell } from "../format/types.js";
import { parseDocument, parseLinkRef } from "../cell-format/index.js";
import { containsPhrase } from "../checks/shared.js";
import { DIRECTOR_CHECK_SUITE_ID, loadDirectorContracts, loadSpecificity, type DirectorContracts, type DirectorSlotContract, type Specificity } from "./format.js";

export type DirectorCheckId = "D-REQ" | "D-SPEC" | "D-COVER" | "INPUT";
export const DIRECTOR_CHECKS: ReadonlyArray<{ id: Exclude<DirectorCheckId, "INPUT">; description: string }> = [
  { id: "D-REQ", description: "Every required Direction key is present with a filled, non-placeholder value." },
  { id: "D-SPEC", description: "Direction values contain no generic filler phrase from the specificity list." },
  { id: "D-COVER", description: "Every downstream cell whose slot cites this cell links its current version." },
];

export interface DirectorFinding {
  check: DirectorCheckId;
  slot: string;
  path: string;
  line?: number;
  key?: string;
  message: string;
}
export interface DownstreamDoc {
  path: string;
  id: string;
  agent: "writer" | "designer" | "unknown";
  /** Writer leaves or the Designer slot this file fills. */
  slots: string[];
  /** Director cells this file links, by id, with the cited version. */
  cites: Array<{ cell: string; version: number }>;
}
export interface CoverageRow {
  cell: string;
  version: number;
  /** Downstream files whose slot declares this cell as an input. */
  expected: number;
  /** Of those, files that link the current version. */
  citing: number;
  /** Any downstream file (Writer or Designer) that links this cell. */
  citers: number;
  ratio: number | null;
}
export interface DirectorSuiteResult {
  suite: typeof DIRECTOR_CHECK_SUITE_ID;
  checks: typeof DIRECTOR_CHECKS;
  files: string[];
  findings: DirectorFinding[];
  coverage: CoverageRow[] | null;
}

const PLACEHOLDER_SHAPE = /<[^>]*>|\{\{[^}]*\}\}|\[(?:todo|tbd|placeholder)\]/i;
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean);

/** Whether a Direction value is filled: not empty, not a placeholder, not a stub. */
export function filledValue(text: string, minWords: number, spec: Specificity = loadSpecificity()): string | undefined {
  const value = text.trim();
  if (!value) return "is empty";
  const bare = value.toLowerCase().replace(/[.!]+$/, "");
  if (spec.placeholders.includes(bare) || /^(tbd|tbc|todo)\b/i.test(value)) return "is a placeholder";
  if (PLACEHOLDER_SHAPE.test(value)) return "contains an unfilled placeholder";
  if (words(value).length < minWords) return `has fewer than ${minWords} words`;
  return undefined;
}

export function checkDirectorCell(cell: Pick<Cell, "id" | "direction" | "path">, contract: DirectorSlotContract, spec: Specificity = loadSpecificity()): DirectorFinding[] {
  const findings: DirectorFinding[] = [];
  const path = cell.path;
  for (const key of contract.limits.requiredKeys) {
    const bullets = cell.direction.filter(b => b.key === key);
    if (bullets.length === 0) { findings.push({ check: "D-REQ", slot: contract.id, path, key, message: `Required key ${key} is missing` }); continue; }
    for (const bullet of bullets) {
      const minWords = contract.limits.singleTokenKeys.includes(key) ? 1 : contract.limits.minWordsPerKey;
      const problem = filledValue(bullet.text, minWords, spec);
      if (problem) findings.push({ check: "D-REQ", slot: contract.id, path, line: bullet.line, key, message: `${key} ${problem}` });
    }
  }
  for (const bullet of cell.direction) {
    if (bullet.key && spec.negativeKeys.includes(bullet.key)) continue;
    for (const phrase of spec.filler) {
      if (containsPhrase(bullet.text, phrase)) findings.push({ check: "D-SPEC", slot: contract.id, path, line: bullet.line, ...(bullet.key ? { key: bullet.key } : {}), message: `Generic phrase "${phrase}"; say what is specific to this business` });
    }
  }
  return findings;
}

const DESIGNER_SLOT = /^(tokens|assets|components|sections|frames)\.[a-z][a-z0-9-]*$/;
const WRITER_LEAF = /"leaf"\s*:\s*"((?:lexicon|strings|patterns|passages|narratives)\.[a-z0-9-]+)"/g;
const DIRECTOR_AGENTS = new Set(["director", "strategist"]);
const DIRECTOR_ID = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;

/** Read the frontmatter links and slot of a downstream Writer or Designer cell. */
export function parseDownstream(source: string, path: string): DownstreamDoc {
  const parsed = parseDocument(source);
  if (!parsed.ok) throw new Error(`${path}:${parsed.issues[0]?.line ?? 1}: ${parsed.issues[0]?.message ?? "unreadable cell"}`);
  const fields = parsed.value.fields as Record<string, unknown>;
  const id = typeof fields.id === "string" ? fields.id : "";
  const links = Array.isArray(fields.links) ? fields.links.filter((l): l is string => typeof l === "string") : [];
  const cites: DownstreamDoc["cites"] = [];
  for (const link of links) {
    const ref = parseLinkRef(link);
    if (!ref || !DIRECTOR_ID.test(ref.cell)) continue;
    if (ref.agent !== undefined && !DIRECTOR_AGENTS.has(ref.agent)) continue;
    cites.push({ cell: ref.cell, version: ref.version });
  }
  if (DESIGNER_SLOT.test(id)) return { path, id, agent: "designer", slots: [id], cites };
  const leaves = [...new Set([...source.matchAll(WRITER_LEAF)].map(m => m[1]!))].sort();
  return { path, id, agent: leaves.length ? "writer" : "unknown", slots: leaves, cites };
}

export function checkDirectorCoverage(cells: Array<{ id: string; version: number }>, downstream: DownstreamDoc[], contracts: DirectorContracts = loadDirectorContracts()): { findings: DirectorFinding[]; coverage: CoverageRow[] } {
  const byId = new Map(contracts.slots.map(s => [s.id, s]));
  const findings: DirectorFinding[] = []; const coverage: CoverageRow[] = [];
  for (const cell of cells) {
    const contract = byId.get(cell.id);
    if (!contract) continue;
    const feeds = new Set(contract.feeds);
    let expected = 0, citing = 0;
    for (const doc of downstream) {
      if (!doc.slots.some(s => feeds.has(s))) continue;
      expected++;
      const cited = doc.cites.filter(c => c.cell === cell.id);
      if (cited.length === 0) findings.push({ check: "D-COVER", slot: cell.id, path: doc.path, message: `${doc.id} fills ${doc.slots.filter(s => feeds.has(s)).join(", ")} but does not cite ${cell.id}` });
      else if (!cited.some(c => c.version === cell.version)) findings.push({ check: "D-COVER", slot: cell.id, path: doc.path, message: `${doc.id} cites ${cell.id}@${cited.map(c => c.version).join(",")}; current is @${cell.version}` });
      else citing++;
    }
    const citers = downstream.filter(doc => doc.cites.some(c => c.cell === cell.id)).length;
    coverage.push({ cell: cell.id, version: cell.version, expected, citing, citers, ratio: expected ? citing / expected : null });
  }
  return { findings, coverage };
}

export interface SuiteInput { path: string; text: string }

/** Run the whole suite over Director cell files and, optionally, downstream files. */
export function runDirectorSuite(input: { cells: SuiteInput[]; downstream?: SuiteInput[] }, contracts: DirectorContracts = loadDirectorContracts()): DirectorSuiteResult {
  const byId = new Map(contracts.slots.map(s => [s.id, s]));
  const findings: DirectorFinding[] = []; const checked: Array<{ id: string; version: number }> = [];
  for (const file of input.cells) {
    const parsed = parseCell(file.text, file.path);
    if (!parsed.ok) { findings.push({ check: "INPUT", slot: "?", path: file.path, line: parsed.issues[0]?.line, message: parsed.issues.map(i => i.message).join("; ") }); continue; }
    const contract = byId.get(parsed.value.id);
    if (!contract) { findings.push({ check: "INPUT", slot: parsed.value.id, path: file.path, message: `No Director slot contract for ${parsed.value.id}` }); continue; }
    checked.push({ id: parsed.value.id, version: parsed.value.version });
    findings.push(...checkDirectorCell({ ...parsed.value, path: file.path }, contract));
  }
  let coverage: CoverageRow[] | null = null;
  if (input.downstream) {
    const docs: DownstreamDoc[] = [];
    for (const file of input.downstream) {
      try { docs.push(parseDownstream(file.text, file.path)); } catch (error) { findings.push({ check: "INPUT", slot: "?", path: file.path, message: error instanceof Error ? error.message : String(error) }); }
    }
    const result = checkDirectorCoverage(checked, docs, contracts);
    findings.push(...result.findings); coverage = result.coverage;
  }
  return { suite: DIRECTOR_CHECK_SUITE_ID, checks: DIRECTOR_CHECKS, files: input.cells.map(f => f.path), findings, coverage };
}
