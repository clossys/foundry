import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { checkCoverage } from "./check.js";
import { inputRoots, loadCoverageInput, type LoadOptions } from "./load.js";
import type { CoverageInput, CoverageReport } from "./types.js";

interface IO { out(text: string): void; error(text: string): void }
const defaultIO: IO = { out: text => console.log(text), error: text => console.error(text) };
const USAGE = "designer-library ia-coverage [--catalog <dir>] [--writer-catalog <dir>] [--publisher-input <ContentRegistry.json>] [--checks <results.json>] [--input <snapshot.json>] [--out <ia-coverage.json>]\nRead-only audit; only the separate report is written. Exit 0: no findings; 1: findings; 2: invalid input or I/O error.";
const flags = new Set(["--catalog", "--writer-catalog", "--publisher-input", "--checks", "--input", "--out"]);
function parse(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]!;
    if (!flags.has(flag)) throw new TypeError(`unknown option ${flag}`);
    const value = argv[++index];
    if (!value || value.startsWith("--") || args.has(flag)) throw new TypeError(`${flag} needs exactly one value`);
    args.set(flag, value);
  }
  if (args.has("--input") && ["--catalog", "--writer-catalog", "--publisher-input", "--checks"].some(flag => args.has(flag))) throw new TypeError("--input cannot be combined with catalog adapters");
  return args;
}
function snapshot(path: string): CoverageInput {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object") throw new TypeError("input snapshot must be an object");
  const input = value as Record<string, unknown>;
  for (const key of ["placements", "slots", "fills", "edges", "adminRoots"]) if (!Array.isArray(input[key])) throw new TypeError(`input snapshot requires ${key} array`);
  if (typeof input.adminInputsComplete !== "boolean") throw new TypeError("input snapshot requires adminInputsComplete boolean");
  return value as CoverageInput;
}
/** Resolve existing ancestors without following the output filename (atomic rename replaces symlinks). */
function canonicalDestination(path: string): string {
  const tail: string[] = [basename(path)]; let parent = dirname(path);
  while (!existsSync(parent)) { tail.unshift(basename(parent)); const next = dirname(parent); if (next === parent) break; parent = next; }
  return resolve(realpathSync(parent), ...tail);
}
function inside(path: string, root: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot === "" || (!isAbsolute(fromRoot) && fromRoot !== ".." && !fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`));
}
function writeReport(path: string, report: CoverageReport, roots: string[], files: string[]): void {
  const destination = canonicalDestination(resolve(path));
  const protectedRoots = roots.filter(existsSync).map(root => realpathSync(root));
  const protectedFiles = files.filter(existsSync).map(file => realpathSync(file));
  if (protectedRoots.some(root => inside(destination, root)) || protectedFiles.includes(destination)) throw new TypeError("report output must be separate from catalog/input data");
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${randomUUID()}`;
  try { writeFileSync(temporary, JSON.stringify(report, null, 2) + "\n", { flag: "wx" }); renameSync(temporary, destination); }
  finally { rmSync(temporary, { force: true }); }
}
export function summaryTable(report: CoverageReport): string {
  const rows = ["| Layer | L0 | L1 | L2 | L3 | absent | draft | checked | approved |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|"];
  for (const [layer, row] of Object.entries(report.summary.layers)) rows.push(`| ${layer} | ${row.L0} | ${row.L1} | ${row.L2} | ${row.L3} | ${row.states.absent} | ${row.states.draft} | ${row.states.checked} | ${row.states.approved} |`);
  rows.push(`Findings: ${JSON.stringify(report.summary.priorities)}; dangling=${report.summary.dangling.length}, unresolved=${report.summary.unresolved.length}, orphans=${report.summary.orphans.length}, cycles=${report.summary.cycles.length}`);
  if (report.basis.needs.length) rows.push("Needs:\n" + report.basis.needs.map(need => `- ${need}`).join("\n"));
  return rows.join("\n");
}
export async function main(argv: string[], io: IO = defaultIO): Promise<number> {
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0]!)) { io.out(USAGE); return 0; }
  try {
    const args = parse(argv);
    const options: LoadOptions = { ...(args.has("--catalog") ? { catalogRoot: args.get("--catalog")! } : {}),
      ...(args.has("--writer-catalog") ? { writerCatalogRoot: args.get("--writer-catalog")! } : {}),
      ...(args.has("--publisher-input") ? { publisherInput: args.get("--publisher-input")! } : {}),
      ...(args.has("--checks") ? { checksInput: args.get("--checks")! } : {}) };
    const input = args.has("--input") ? snapshot(args.get("--input")!) : loadCoverageInput(options);
    const report = checkCoverage(input), out = args.get("--out") ?? "ia-coverage.json";
    report.basis.inputMode = args.has("--input") ? "supplied-snapshot" : "catalog";
    report.basis.inputsHash = `sha256:${createHash("sha256").update(JSON.stringify(input)).digest("hex")}`;
    writeReport(out, report, inputRoots(options), [args.get("--input"), options.publisherInput, options.checksInput].filter((path): path is string => !!path));
    io.out(summaryTable(report)); io.out(`Report: ${resolve(out)}`);
    return report.findings.length ? 1 : 0;
  } catch (error) { io.error(`ia-coverage: ${error instanceof Error ? error.message : String(error)}`); return 2; }
}
