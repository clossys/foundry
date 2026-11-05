#!/usr/bin/env node
/**
 * check:flat-slots: the consumer store is flat slot folders, `clossys/agents/<agent>/<slot-id>/`,
 * with grouping only in each agent's ia.json data (rule R-FLAT-SLOTS). No legacy store is kept,
 * read or shipped: not the element library `clossys/library/`, not a cells store
 * (`cells/<id>/v<n>.md` under a `tree.json` of active pointers).
 *
 * A finding is:
 *   - store    `<root>/clossys/{library,cells,tree.json}` exists, or an agent folder holds
 *              `library`, `cells` or `tree.json`;
 *   - layout   an agent folder entry other than `ia.json` that is not a directory, or a slot
 *              folder that nests a directory other than `candidates/`, or a `candidates/` folder
 *              that nests a directory (grouping lives in ia.json, never in folders);
 *   - reader   a code file names a legacy store path (a quoted `clossys/library`, `clossys/cells`,
 *              `clossys/tree.json` or `clossys/agents/<agent>/{library,cells,tree.json}`) or joins a
 *              legacy store segment onto a root (`join(root, "cells" | "tree.json" | "library")` and
 *              the same shape through resolve/readJson/read/readFile/readdir/directory/entries/safe);
 *   - shipped  a package manifest (packages/<pkg>/package.json) or the committed pipeline graph
 *              (packages/producer/pipeline/graph.json) declares a legacy store path, or a record
 *              folder the slot model does not keep (`clossys/agents/<agent>/{findings,requests,sessions}/`;
 *              Director evidence is `clossys/evidence/director/`), or a generated file inside an agent
 *              tree (`clossys/agents/<agent>/{briefs/,reports/,citations.json}`; Director's compiled
 *              briefs and reports are `clossys/evidence/director/{briefs,reports}/`); code naming one
 *              in a quoted path is a reader finding;
 *   - skill    shipped agent instructions (packages/<pkg>/skill/**\/*.md and the launcher's
 *              skill-catalogue copies) name a legacy store path or record folder, or teach the
 *              cells layout (`cells/<id>`, `tree.json`, `sessions/<…>`, `requests/REQ-…`).
 * Code files are those check:no-selection-store scans (scripts/check-no-selection-store.mjs
 * `scopeFiles`): packages/<pkg>/{src,bin,scripts}, the Studio app and root scripts/, outside tests,
 * fixtures, node_modules and dist.
 *
 * Usage: node scripts/check-flat-slots.mjs [--root DIR] [--json]
 * Exit 0 with no finding, 1 on any finding, 2 on a usage error.
 */
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scopeFiles } from "./check-no-selection-store.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SELF = "scripts/check-flat-slots.mjs";
const LEGACY = ["library", "cells", ["tree", "json"].join(".")];
const q = "[\"'`]";
const STORE_PATH = new RegExp(`clossys/(?:library|cells|tree\\.json|agents/[a-z][a-z0-9-]*/(?:library|cells|tree\\.json))(?![\\w.-])`);
const QUOTED_STORE_PATH = new RegExp(`${q}[^"'\`\\n]*${STORE_PATH.source}`);
const STORE_JOIN = new RegExp(`\\b(?:join|resolve|readJson|read|readFile|readdir|directory|entries|safe)\\(\\s*[A-Za-z_$][\\w$.]*\\s*,\\s*${q}(?:cells|tree\\.json|library)${q}`);
const RECORD_PATH = /clossys\/agents\/[a-z][a-z0-9-]*\/(?:findings|requests|sessions)\//;
// Generated working files (compiled briefs, reports, the citation index) never sit in an agent tree.
const GENERATED_PATH = /clossys\/agents\/[a-z][a-z0-9-]*\/(?:briefs\/|reports\/|citations\.json)/;
const QUOTED_GENERATED_PATH = new RegExp(`${q}[^"'\`\\n]*${GENERATED_PATH.source}`);
const CELLS_LAYOUT = /(?:^|[\s`'"(])(?:cells\/<|tree\.json|sessions\/<|requests\/REQ-)/;
const SKILL_ROOTS = ["skill", "skill-catalogue"];
const SLOT_DIRS = new Set(["candidates"]);

const isDir = path => { try { return lstatSync(path).isDirectory(); } catch { return false; } };

/** Store and layout findings under <root>/clossys. */
export function storeFindings(root) {
  const findings = [];
  const consumer = join(root, "clossys");
  for (const name of LEGACY) if (existsSync(join(consumer, name))) findings.push({ kind: "store", path: `clossys/${name}`, message: `legacy store clossys/${name} is kept beside clossys/agents/` });
  const agents = join(consumer, "agents");
  if (!isDir(agents)) return findings;
  for (const agent of readdirSync(agents).sort()) {
    const folder = join(agents, agent), where = `clossys/agents/${agent}`;
    if (!isDir(folder)) { findings.push({ kind: "layout", path: where, message: "an agents/ entry is not an agent folder" }); continue; }
    for (const entry of readdirSync(folder).sort()) {
      const path = join(folder, entry), at = `${where}/${entry}`;
      if (LEGACY.includes(entry)) { findings.push({ kind: "store", path: at, message: `legacy store ${entry} inside an agent folder` }); continue; }
      if (entry === "ia.json") continue;
      if (!isDir(path)) { findings.push({ kind: "layout", path: at, message: "an agent folder holds only ia.json and slot folders" }); continue; }
      for (const inner of readdirSync(path).sort()) {
        const innerPath = join(path, inner);
        if (!isDir(innerPath)) continue;
        if (!SLOT_DIRS.has(inner)) { findings.push({ kind: "layout", path: `${at}/${inner}`, message: "a slot folder nests a directory other than candidates/ (group in ia.json, not folders)" }); continue; }
        for (const candidate of readdirSync(innerPath).sort()) if (isDir(join(innerPath, candidate))) findings.push({ kind: "layout", path: `${at}/${inner}/${candidate}`, message: "candidates/ holds files only" });
      }
    }
  }
  return findings;
}

/** Reader findings in code, shipped findings in manifests and the pipeline graph. */
export function codeFindings(root) {
  const findings = [];
  const scan = (file, kind, patterns) => {
    const lines = readFileSync(join(root, file), "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const [what, pattern] of patterns) if (pattern.test(line)) { findings.push({ kind, path: `${file}:${index + 1}`, message: what }); break; }
    });
  };
  for (const file of scopeFiles(root)) if (file !== SELF) scan(file, "reader", [["names a legacy store path", QUOTED_STORE_PATH], ["joins a legacy store segment onto a root", STORE_JOIN], ["names a generated file inside an agent tree", QUOTED_GENERATED_PATH]]);
  const manifests = [];
  const packages = join(root, "packages");
  if (isDir(packages)) for (const pkg of readdirSync(packages).sort()) if (existsSync(join(packages, pkg, "package.json"))) manifests.push(`packages/${pkg}/package.json`);
  if (existsSync(join(root, "packages/producer/pipeline/graph.json"))) manifests.push("packages/producer/pipeline/graph.json");
  for (const file of manifests) scan(file, "shipped", [["declares a legacy store path", STORE_PATH], ["declares a record folder the slot model does not keep", RECORD_PATH], ["declares a generated file inside an agent tree (Director outputs are clossys/evidence/director/)", GENERATED_PATH]]);
  for (const file of skillFiles(root)) scan(file, "skill", [["names a legacy store path", STORE_PATH], ["names a record folder the slot model does not keep", RECORD_PATH], ["teaches the legacy cells layout", CELLS_LAYOUT]]);
  return findings;
}

/** Shipped agent instructions: every Markdown file under packages/<pkg>/{skill,skill-catalogue}/. */
export function skillFiles(root) {
  const files = [], packages = join(root, "packages");
  const walk = rel => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const at = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(at);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(at);
    }
  };
  if (isDir(packages)) for (const pkg of readdirSync(packages).sort()) for (const dir of SKILL_ROOTS) if (isDir(join(packages, pkg, dir))) walk(`packages/${pkg}/${dir}`);
  return files;
}

function main(args) {
  const at = args.indexOf("--root");
  if (at >= 0 && !args[at + 1]) { console.error("check-flat-slots: --root needs a directory"); return 2; }
  for (const [index, arg] of args.entries()) if (arg.startsWith("--") && arg !== "--root" && arg !== "--json" || (!arg.startsWith("--") && index !== at + 1)) { console.error(`check-flat-slots: unknown argument ${arg}`); return 2; }
  const root = at >= 0 ? resolve(args[at + 1]) : resolve(here, "..");
  if (!isDir(join(root, "clossys"))) { console.error(`check-flat-slots: no clossys/ under ${root}`); return 2; }
  const findings = [...storeFindings(root), ...codeFindings(root)];
  if (args.includes("--json")) console.log(JSON.stringify({ findings }, null, 2));
  else {
    console.log(`check-flat-slots: ${findings.length} finding(s)`);
    for (const finding of findings) console.log(`  ${finding.path} [${finding.kind}] ${finding.message}`);
  }
  return findings.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
