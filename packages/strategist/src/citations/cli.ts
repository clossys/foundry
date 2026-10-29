import { closeSync, constants, fstatSync, ftruncateSync, lstatSync, openSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Brief } from "../brief.js";
import { discoverBriefContracts, readBriefRootFile } from "../brief-contracts.js";
import { DEFAULT_SKIP_DIRS, scanStrategyDirectory, type ScanOptions } from "../scan.js";
import { readStrategyRoot } from "../store.js";
import { buildCitationIndex } from "./index.js";
import { resolveStrategyRoot } from "../strategy-dir-default.js";

const USAGE = `Usage: strategist-check index [--root <dir>] [--check] [--scan <dir>…] [--json]

Build citations.json, or check current sources without writing with --check.
The root defaults to <repo root>/clossys/agents/director. Briefs are read from briefs/*.json.
Scan sources include strategy:<cell>@<version> markers and JSON {cell, version} objects.
--scan is repeatable. --extensions, --skip-dirs and --exclude are repeatable;
skip directory names are added to node_modules, .git, dist, build and coverage.
Default extensions: .md, .mdx, .ts, .tsx, .js, .jsx, .json.
Exit codes: 0 clean, 1 stale/dangling citations, written brief fingerprint drift or unsafe output target,
2 unreadable/invalid inputs or invalid arguments.
`;

class CitationIndexTargetError extends Error {
  constructor(reason: string) { super(`CitationIndexTargetError: ${reason}`); this.name = "CitationIndexTargetError"; }
}

/** Check every directory the scanner follows, including directory aliases. */
function refuseScannedTarget(target: string, dirs: string[], skipDirs: string[]): void {
  const visited = new Set<string>();
  const walk = (dir: string): void => {
    const directory = realpathSync(dir);
    const path = relative(directory, target);
    if (path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`))) {
      throw new CitationIndexTargetError("citations.json resolves inside a scanned surface");
    }
    if (visited.has(directory)) return;
    visited.add(directory);
    for (const name of readdirSync(dir)) {
      if (skipDirs.includes(name)) continue;
      const child = join(dir, name);
      let stat;
      try { stat = statSync(child); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      if (stat.isDirectory()) walk(child);
    }
  };
  dirs.forEach(walk);
}

/** Read files through the confined ST-2 reader; reject unsafe brief directories. */
function readBriefs(root: string): { path: string; brief: Brief }[] {
  const directory = join(root, "briefs");
  try {
    const stat = lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Brief directory is unsafe");
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const result: { path: string; brief: Brief }[] = [];
  for (const name of readdirSync(directory).sort()) {
    if (!name.endsWith(".json")) continue;
    const path = `briefs/${name}`;
    const bytes = readBriefRootFile(root, path);
    if (bytes === undefined) throw new Error(`Brief disappeared while reading: ${path}`);
    const value: unknown = JSON.parse(bytes);
    // The generated inventory is not itself a compiled brief. Its refs are still
    // scanned as generic JSON, by the caller, rather than compiled as a contract.
    if (name === "index.json") continue;
    if (!value || typeof value !== "object" || !("contract" in value) || typeof value.contract !== "string" || !("fingerprint" in value) || typeof value.fingerprint !== "string" || !("cells" in value) || !Array.isArray(value.cells)) throw new Error(`Invalid written brief: ${path}`);
    result.push({ path, brief: value as Brief });
  }
  return result;
}

/** Kept separate so the shared CLI dispatch only adds the index subcommand. */
export function runCitationIndex(argv: string[]): number {
  let json = false;
  try {
    let root: string | undefined; let check = false; let explicitRoot = false;
    const dirs: string[] = []; const extensions: string[] = []; const skipDirs: string[] = []; const excludeGlobs: string[] = [];
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i]!;
      if (arg === "--help") { console.log(USAGE); return 0; }
      if (arg === "--json") { json = true; continue; }
      if (arg === "--check") { check = true; continue; }
      const [flag, attached] = arg.split(/=(.*)/s, 2);
      if (!["--root", "--scan", "--extensions", "--skip-dirs", "--exclude"].includes(flag!)) throw new Error(`Unknown index argument: ${arg}`);
      const value = attached ?? argv[++i];
      if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`);
      if (flag === "--root") { if (explicitRoot) throw new Error("--root given more than once"); root = resolve(value); explicitRoot = true; }
      else if (flag === "--scan") {
        dirs.push(resolve(value));
        while (argv[i + 1] && !argv[i + 1]!.startsWith("-")) dirs.push(resolve(argv[++i]!));
      } else if (flag === "--extensions") {
        if (!value.startsWith(".") || value.length < 2 || value.includes("/")) throw new Error('each --extensions value must include the leading dot and name only, e.g. --extensions .md (not "md" or ".")');
        extensions.push(value);
      }
      else if (flag === "--skip-dirs") skipDirs.push(value);
      else excludeGlobs.push(value);
    }
    root = resolveStrategyRoot(root, process.cwd(), check ? "read" : "write");
    const target = join(root, "citations.json");
    const generated = (() => {
      try { return lstatSync(target); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
    })();
    if (generated?.isSymbolicLink()) throw new CitationIndexTargetError("citations.json must not be a symlink");
    if (generated && (!generated.isFile() || generated.nlink > 1)) throw new CitationIndexTargetError("citations.json must be a regular file without hardlink aliases");
    refuseScannedTarget(join(realpathSync(root), "citations.json"), dirs, [...DEFAULT_SKIP_DIRS, ...skipDirs]);
    const model = readStrategyRoot(root);
    if (!model.tree || model.issues.length) throw new Error(`Strategy root is unreadable or invalid: ${model.issues.map(issue => issue.path).join(", ")}`);
    const discovered = discoverBriefContracts(root, model.catalog);
    if (discovered.issues.length) throw new Error(`Brief contracts are unreadable or invalid: ${discovered.issues.map(issue => issue.path).join(", ")}`);
    const briefs = readBriefs(root);
    const options: ScanOptions = {
      extensions: extensions.length ? extensions : [".md", ".mdx", ".ts", ".tsx", ".js", ".jsx", ".json"],
      skipDirs: [...DEFAULT_SKIP_DIRS, ...skipDirs], excludeGlobs,
    };
    const files = dirs.flatMap(dir => scanStrategyDirectory(dir, options).map(file => {
      const source = statSync(resolve(dir, file.path));
      if (generated && source.dev === generated.dev && source.ino === generated.ino) {
        throw new CitationIndexTargetError("citations.json aliases a scanned source");
      }
      return { ...file, path: relative(root, join(dir, file.path)).split(sep).join("/") };
    }));
    const inventory = readBriefRootFile(root, "briefs/index.json");
    if (inventory !== undefined) files.push({ path: "briefs/index.json", content: inventory });
    const result = buildCitationIndex(model, { files, briefs, contracts: discovered.contracts });
    if (!check) {
      // O_NOFOLLOW keeps a pre-existing symlink from redirecting this generated file.
      const fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.nlink > 1) throw new CitationIndexTargetError("citations.json must be a regular file without hardlink aliases");
        ftruncateSync(fd); writeFileSync(fd, `${JSON.stringify(result, null, 2)}\n`);
      } finally { closeSync(fd); }
    }
    if (json) console.log(JSON.stringify(result));
    else {
      console.log(`Citation index: ${result.entries.length} entries; ${result.stale.length} stale; ${result.dangling.length} dangling; ${result.drift.length} brief fingerprint mismatches.`);
      for (const entry of [...result.stale, ...result.dangling]) console.log(`  ${entry.by.path}${entry.by.line ? `:${entry.by.line}` : ""}: ${entry.ref.cell}@${entry.ref.version}`);
      for (const mismatch of result.drift) console.log(`  ${mismatch.path}: fingerprint differs from fresh ${mismatch.contract}`);
    }
    return result.stale.length || result.dangling.length || result.drift.length ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) console.log(JSON.stringify({ error: message })); else console.error(`Citation index could not run: ${message}`);
    return error instanceof CitationIndexTargetError ? 1 : 2;
  }
}
