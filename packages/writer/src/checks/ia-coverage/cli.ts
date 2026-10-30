import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { loadWriterCatalog } from "../../catalog/ia/index.js";
import { loadWriterLibrary } from "../../loader/load.js";
import { checkIACoverage } from "./index.js";
import type { ConnectionSnapshot, CoverageInput, CoverageReport, DesignerCatalogShape } from "./types.js";
import type { WriterRecord } from "../../model/types.js";

const USAGE = `writer-check ia-coverage [--root <consumer-library>] [--connections <snapshot.json>] [--out <directory>] [--format text|json]
Read-only, bottom-up IA observation. Writes ia-coverage.json outside the optional library root.
--connections: {nodes:[{id,uses:[]}],adminRoots:[],completeAdminGraph:boolean}.
Uses the installed @clossys/designer/catalog export; no Designer source paths.
Without --root, shipped catalog records establish draft presence only. Without a complete connection snapshot, unproven admin reachability is unknown.
Default output directory: .writer-ia-coverage under cwd. Exit 0: no findings; 1: findings; 2: invalid/unavailable input.
`;
interface Options { root?: string; connections?: string; out: string; format: "text" | "json" }
interface Ports {
  loadInput?: (options: Options) => Promise<CoverageInput>;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const stringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");

async function loadInput(options: Options): Promise<CoverageInput> {
  // Optional peer capability: existing Writer commands must not need Designer installed.
  const publicExport = "@clossys/designer/catalog";
  const peer = await import(publicExport);
  if (typeof peer.loadBuildCatalog !== "function") throw new Error("Designer catalog export lacks loadBuildCatalog");
  const designer: unknown = peer.loadBuildCatalog();
  if (!object(designer) || !Array.isArray(designer.slots) || !designer.slots.every(slot => object(slot) && typeof slot.id === "string" && object(slot.contract) && (slot.requires === undefined || stringList(slot.requires)))) throw new Error("Invalid published Designer catalog shape");
  if (designer.standards !== undefined && (!Array.isArray(designer.standards) || !designer.standards.every(standard => object(standard) && typeof standard.id === "string" && Array.isArray(standard.clauses) && standard.clauses.every(clause => object(clause) && typeof clause.id === "string")))) throw new Error("Invalid published Designer standards shape");
  let connections: ConnectionSnapshot | undefined;
  if (options.connections) {
    const value: unknown = JSON.parse(readFileSync(options.connections, "utf8"));
    if (!object(value) || !Array.isArray(value.nodes) || !value.nodes.every(node => object(node) && typeof node.id === "string" && stringList(node.uses)) || !stringList(value.adminRoots) || typeof value.completeAdminGraph !== "boolean") throw new Error("Invalid connections snapshot");
    connections = value as unknown as ConnectionSnapshot;
  }
  const loaded = options.root ? loadWriterLibrary(options.root) : undefined;
  if (loaded && !loaded.library) throw new Error(loaded.issues.map(issue => `${issue.path}: ${issue.message}`).join("; "));
  const catalogRecords: { locale: string; records: WriterRecord[] }[] = [];
  if (!loaded) {
    // Resolve source data from either src/checks or dist/checks; data ships under src.
    const source = new URL("../../../src/catalog/records/", import.meta.url);
    const locales = new Map<string, WriterRecord[]>();
    for (const name of readdirSync(source).filter(name => name.endsWith(".json")).sort()) {
      const data: unknown = JSON.parse(readFileSync(new URL(name, source), "utf8"));
      const append = (locale: string, records: unknown): void => {
        if (!Array.isArray(records) || !records.every(record => object(record) && typeof record.id === "string" && typeof record.leaf === "string")) throw new Error(`Invalid catalog records in ${name}`);
        locales.set(locale, [...locales.get(locale) ?? [], ...records as WriterRecord[]]);
      };
      if (object(data) && typeof data.locale === "string") append(data.locale, data.records);
      else if (object(data) && object(data.locales)) for (const [locale, content] of Object.entries(data.locales)) {
        if (!object(content)) throw new Error(`Invalid catalog locale in ${name}`);
        append(locale, content.records);
      }
      else throw new Error(`Invalid catalog record envelope in ${name}`);
    }
    for (const [locale, records] of locales) catalogRecords.push({ locale, records });
  }
  return { catalog: loadWriterCatalog(), designer: designer as unknown as DesignerCatalogShape, connections, library: loaded?.library ?? undefined, catalogRecords };
}

export function coverageSummaryTable(report: CoverageReport): string {
  return ["| Level | Count |", "| --- | ---: |", ...["L3", "L2", "L1", "L0"].map(level => `| ${level} | ${report.summary.levels[level as keyof typeof report.summary.levels]} |`), "", "| State | Count |", "| --- | ---: |", ...Object.entries(report.summary.states).map(([state, count]) => `| ${state} | ${count} |`), "", `Findings: ${report.findings.length}; dangling: ${report.dangling.length}; orphans: ${report.orphans.length}; cycles: ${report.cycles.length}`, ...report.findings.map(row => `${row.priority} ${row.code} ${row.subject}: ${row.detail}`), ...report.needs.map(need => `Need: ${need}`)].join("\n") + "\n";
}

/** Reports are derived output; catalog/library data is never written. */
export async function mainIACoverage(args: readonly string[], ports: Ports = {}): Promise<number> {
  const stdout = ports.stdout ?? (text => process.stdout.write(text)), stderr = ports.stderr ?? (text => process.stderr.write(text));
  let temporary: string | undefined;
  try {
    if (args.length === 1 && args[0] === "--help") { stdout(USAGE); return 0; }
    const options: Options = { out: resolve(".writer-ia-coverage"), format: "text" }, seen = new Set<string>();
    for (let i = 0; i < args.length; i++) {
      const flag = args[i]!, value = args[++i];
      if (!["--root", "--connections", "--out", "--format"].includes(flag) || seen.has(flag) || !value || value.startsWith("--")) throw new Error(`Invalid option ${flag}`);
      seen.add(flag);
      if (flag === "--format") {
        if (value !== "text" && value !== "json") throw new Error("--format must be text or json");
        options.format = value;
      } else if (flag === "--root") options.root = resolve(value);
      else if (flag === "--connections") options.connections = resolve(value);
      else options.out = resolve(value);
    }
    const input = await (ports.loadInput ?? loadInput)(options);
    const target = join(options.out, "ia-coverage.json");
    if (options.connections && resolve(options.connections) === target) throw new Error("Report must not replace the connection snapshot");
    // Canonicalize parents before checking containment, including symlinked output directories.
    if (options.root) {
      const root = realpathSync(options.root);
      let existing = options.out;
      while (true) {
        try { existing = realpathSync(existing); break; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; const parent = dirname(existing); if (parent === existing) throw error; existing = parent; }
      }
      const path = relative(root, existing);
      if (path === "" || path !== ".." && !path.startsWith("../")) throw new Error("Report output must be outside the library root");
    }
    const report = checkIACoverage(input), json = JSON.stringify(report, null, 2) + "\n";
    mkdirSync(options.out, { recursive: true });
    try { if (!lstatSync(target).isFile() || lstatSync(target).isSymbolicLink()) throw new Error("Report target must be a regular file"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    temporary = join(options.out, `.ia-coverage.${randomUUID()}.tmp`);
    writeFileSync(temporary, json, { flag: "wx" }); renameSync(temporary, target); temporary = undefined;
    stdout(options.format === "json" ? json : coverageSummaryTable(report));
    return report.findings.length ? 1 : 0;
  } catch (error) {
    stderr(`ia-coverage: ${error instanceof Error ? error.message : String(error)}\n`); return 2;
  } finally { if (temporary) rmSync(temporary, { force: true }); }
}
