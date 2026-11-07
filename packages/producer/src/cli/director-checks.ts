/**
 * `clossys director check brand|direction|apply`: deterministic checks over the pinned Director
 * slots and Director's catalog. Each reads the strategy root through the slot-model reader, makes
 * no model call and writes nothing. Exit 0 clean, 1 findings, 2 could not run.
 */
import { resolve } from "node:path";
import { readStrategyRoot, scanStrategyDirectory, type StrategyModel } from "@clossys/director";
import { directorStoreReader } from "../records/slots.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

export const DIRECTOR_CHECKS = ["brand", "direction", "apply"] as const;
type DirectorCheck = typeof DIRECTOR_CHECKS[number];
interface Finding { rule: string; cell: string; message: string; path?: string }

export const DIRECTOR_CHECKS_USAGE = "       clossys director check brand [--root <dir>] [--json]\n"
  + "       clossys director check direction [--root <dir>] [--json]\n"
  + "       clossys director check apply <scan-dir> [--root <dir>] [--json]\n"
  + "brand: every core Identity cell with the brand function is pinned. direction: every cell citation in a pinned\n"
  + "candidate names the cited slot's pinned version. apply: every scanned surface carries a strategy:<cell>@<n> marker\n"
  + "for each pinned constraint cell at its pinned version. The root defaults to <repo root>/clossys/agents/director.";

const MARKER = /strategy:([a-z]+(?:-[a-z]+)*\.[a-z]+(?:-[a-z]+)*\.[a-z]+(?:-[a-z]+)*)@([1-9]\d*)/g;
const SURFACE_EXTENSIONS = [".md", ".mdx", ".txt", ".html", ".htm", ".json", ".yml", ".yaml"];

export function isDirectorCheck(name: string | undefined): name is DirectorCheck {
  return (DIRECTOR_CHECKS as readonly string[]).includes(name ?? "");
}

function pinnedVersions(model: StrategyModel): Map<string, number> {
  return new Map(model.cells.filter(cell => cell.status === "active").map(cell => [cell.id, cell.version]));
}

/** Core Identity cells serving the brand function must all be pinned. */
function brand(model: StrategyModel): Finding[] {
  const core = new Set(model.catalog.archetypes.default);
  const pinned = pinnedVersions(model);
  return model.catalog.cells
    .filter(cell => core.has(cell.id) && cell.id.startsWith("identity.") && cell.functions.includes("brand"))
    .filter(cell => !pinned.has(cell.id))
    .map(cell => ({ rule: "brand-uncovered", cell: cell.id, message: `${cell.id} is a core brand cell with no pinned candidate.` }));
}

/** A pinned candidate's cell citations must name the cited slot's pinned version. */
function direction(model: StrategyModel): Finding[] {
  const pinned = pinnedVersions(model);
  const findings: Finding[] = [];
  for (const cell of model.cells) {
    for (const ref of cell.cites) {
      if (ref.kind !== "cell") continue;
      const target = `${ref.ref.cell}@${ref.ref.version}`;
      const current = pinned.get(ref.ref.cell);
      if (current === ref.ref.version) continue;
      const known = model.candidateVersions?.[ref.ref.cell]?.includes(ref.ref.version) ?? false;
      findings.push(current !== undefined && known
        ? { rule: "direction-superseded", cell: cell.id, path: cell.path, message: `${cell.id}@${cell.version} cites ${target}, superseded by ${ref.ref.cell}@${current}.` }
        : { rule: "direction-dangling", cell: cell.id, path: cell.path, message: `${cell.id}@${cell.version} cites ${target}, which is not a pinned or recorded candidate.` });
    }
  }
  return findings;
}

/** Every scanned surface must cite each pinned constraint cell at its pinned version. */
function apply(model: StrategyModel, scanDir: string): Finding[] | string {
  const constraints = model.cells.filter(cell => cell.id.endsWith(".constraint"));
  if (!constraints.length) return "No constraint cell is pinned; nothing to apply.";
  const files = scanStrategyDirectory(scanDir, { extensions: SURFACE_EXTENSIONS });
  if (!files.length) return `No files matched under "${scanDir}"; nothing was scanned.`;
  const findings: Finding[] = [];
  for (const file of files) {
    const cited = new Map<string, Set<number>>();
    for (const match of file.content.matchAll(MARKER)) {
      cited.set(match[1]!, (cited.get(match[1]!) ?? new Set()).add(Number(match[2])));
    }
    for (const cell of constraints) {
      const versions = cited.get(cell.id);
      if (versions?.has(cell.version)) continue;
      findings.push(versions
        ? { rule: "apply-stale", cell: cell.id, path: file.path, message: `${file.path} cites ${cell.id} at @${[...versions].join(", @")}, not the pinned @${cell.version}.` }
        : { rule: "apply-uncited", cell: cell.id, path: file.path, message: `${file.path} does not cite the pinned constraint ${cell.id}@${cell.version}.` });
    }
  }
  return findings;
}

function parse(argv: readonly string[]): { root?: string; json: boolean; positional: string[] } | string {
  let root: string | undefined, json = false;
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--json") json = true;
    else if (arg === "--root") {
      const value = argv[++index];
      if (!value || value.startsWith("-") || root !== undefined) return "--root needs one directory";
      root = value;
    } else if (arg.startsWith("-")) return `Unknown argument: ${arg}`;
    else positional.push(arg);
  }
  return { ...(root === undefined ? {} : { root }), json, positional };
}

function done(check: DirectorCheck, json: boolean, exitCode: 0 | 1 | 2, findings: Finding[], reason?: string): CliResult {
  const state = exitCode === 0 ? "satisfied" : exitCode === 1 ? "violated" : "indeterminate";
  if (json) console.log(JSON.stringify({ command: check, state, findings, ...(reason ? { reason } : {}) }));
  else {
    for (const finding of findings) console.log(`  [${finding.rule}] ${finding.message}`);
    (exitCode === 2 ? console.error : console.log)(`Director ${check}: ${reason ?? state}`);
  }
  return { exitCode, message: "", printed: true };
}

export function runDirectorCheck(argv: readonly string[], cwd = process.cwd()): CliResult {
  const [check, ...rest] = argv as [DirectorCheck, ...string[]];
  const args = parse(rest);
  if (typeof args === "string") return done(check, rest.includes("--json"), 2, [], `${args}\n${DIRECTOR_CHECKS_USAGE}`);
  if (args.positional.length !== (check === "apply" ? 1 : 0)) {
    return done(check, args.json, 2, [], `${check === "apply" ? "apply needs one scan-dir" : `${check} takes no positional arguments`}\n${DIRECTOR_CHECKS_USAGE}`);
  }
  let root: string;
  try { root = args.root !== undefined ? resolve(cwd, args.root) : resolve(discoverRoot(cwd), "clossys", "agents", "director"); }
  catch (error) { return done(check, args.json, 2, [], error instanceof Error ? error.message : String(error)); }
  const model = readStrategyRoot(root, directorStoreReader);
  if (model.issues.length) {
    return done(check, args.json, 2, [], `Strategy root could not be read in full: ${model.issues.map(issue => `${issue.path}: ${issue.message}`).join("; ")}`);
  }
  if (check === "direction" && !model.cells.length) return done(check, args.json, 2, [], "No pinned Director cell; nothing to check.");
  let findings: Finding[] | string;
  try { findings = check === "brand" ? brand(model) : check === "direction" ? direction(model) : apply(model, resolve(cwd, args.positional[0]!)); }
  catch (error) { return done(check, args.json, 2, [], error instanceof Error ? error.message : String(error)); }
  if (typeof findings === "string") return done(check, args.json, 2, [], findings);
  return done(check, args.json, findings.length ? 1 : 0, findings);
}
