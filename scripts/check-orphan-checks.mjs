#!/usr/bin/env node
/**
 * check:orphan-checks: a rule whose check nothing runs is a lie. Every check and test file in
 * the Studio, Producer and Designer packages must be reachable from the root `check` or `test`
 * script, or be named in scripts/check-orphan-checks.exemptions.json with a one-line reason.
 *
 * Checked files, under packages/producer and packages/designer (which holds @clossys/designer-ui
 * at packages/designer/ui), outside dependency, build and fixture folders:
 *   - any `check-*.{mjs,cjs,js}`;
 *   - any `*check*.{mjs,cjs,js}` directly in a `scripts/` folder, and any script in a `checks/` folder;
 *   - any `*.test.{mjs,cjs,js,ts,tsx,mts,cts,jsx}`.
 *
 * Reachability is a static trace, no command runs:
 *   - root `check` and `test` are parsed as POSIX command lists (`&&`, `||`, `;`, `|`);
 *   - `npm run <s>` / `npm test` follow the script in the current package, `--workspace`/`-w`,
 *     `--prefix` or every workspace for `--workspaces`;
 *   - `node <file>`, `node --test <file|glob>...`, `tsx <file>`, `sh|bash <file>` reach the files;
 *   - `vitest run [--config C] [filters]` reaches the files its config `include` globs match;
 *   - a reached JS/TS file reaches what it imports, requires, dynamically imports or names with
 *     `new URL('./x', import.meta.url)`, relative specifiers only;
 *   - three runners dispatch dynamically and are expanded explicitly: scripts/build-workspaces.mjs
 *     (every workspace `build`), scripts/run-gate-suites.mjs (scripts/lib/gate-test-set.mjs) and
 *     packages/producer/scripts/check-studio.mjs (its check-studio.json sub-checks).
 *
 * An exemption needs a real file in scope, a non-empty one-line reason, and must still be an
 * orphan (a stale exemption fails). Usage: node scripts/check-orphan-checks.mjs [--root DIR] [--json]
 * Exit 0 when every file is reached or exempt, 1 on any finding, 2 on a usage or read error.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const SCOPE = Object.freeze(["packages/producer", "packages/designer"]);
export const EXEMPTIONS_FILE = "scripts/check-orphan-checks.exemptions.json";
export const ENTRY_SCRIPTS = Object.freeze(["check", "test"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", ".git", ".turbo", "coverage", "__fixtures__", "fixtures", "__golden__"]);
const JS = /\.(?:mjs|cjs|js)$/;
const CODE = /\.(?:mjs|cjs|js|jsx|ts|tsx|mts|cts)$/;
const TEST = /\.test\.(?:mjs|cjs|js|ts|tsx|mts|cts|jsx)$/;
const STUDIO_RUNNER = "packages/producer/scripts/check-studio.mjs";
const STUDIO_MANIFEST = "packages/producer/scripts/check-studio.json";

const toPosix = path => path.split(sep).join("/");

/** Whether a repository-relative POSIX path is a check or test file this meta-check governs. */
export function isGoverned(rel) {
  if (!SCOPE.some(root => rel.startsWith(`${root}/`))) return false;
  const parts = rel.split("/");
  if (parts.some(part => SKIP_DIRS.has(part)) || rel.endsWith(".d.ts")) return false;
  const name = parts.at(-1), parent = parts.at(-2);
  if (TEST.test(name)) return true;
  if (!JS.test(name)) return false;
  return /^check-/.test(name) || (parent === "scripts" && name.includes("check")) || parent === "checks";
}

function walk(root, dir, out) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(root, dir ? `${dir}/${entry.name}` : entry.name, out); }
    else if (entry.isFile()) out.push(dir ? `${dir}/${entry.name}` : entry.name);
  }
  return out;
}

/** Every repository file under the scope roots (POSIX, repository-relative), dependency folders skipped. */
export function scopeFiles(root) {
  return SCOPE.filter(dir => existsSync(join(root, dir))).flatMap(dir => walk(root, dir, [])).sort();
}

/** Split a command string into simple commands of shell words, honouring quotes and `\` escapes. */
export function simpleCommands(command) {
  const commands = [];
  let words = [], word = "", quote = null, has = false;
  const endWord = () => { if (has) words.push(word); word = ""; has = false; };
  const endCommand = () => { endWord(); if (words.length) commands.push(words); words = []; };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < command.length) word += command[++i];
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; has = true; continue; }
    if (c === "\\" && i + 1 < command.length) { word += command[++i]; has = true; continue; }
    if (c === "&" || c === "|" || c === ";" || c === "\n") { endCommand(); if (command[i + 1] === c) i++; continue; }
    if (c === " " || c === "\t") { endWord(); continue; }
    word += c; has = true;
  }
  endCommand();
  return commands;
}

/** A small glob to RegExp translation: `**`, `*`, `?`, `{a,b}` and `?(x)` (vitest default include). */
export function globRegExp(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") { i++; if (glob[i + 1] === "/") { i++; out += "(?:.*/)?"; } else out += ".*"; }
    else if (c === "*") out += "[^/]*";
    else if (c === "?" && glob[i + 1] === "(") { const end = glob.indexOf(")", i); out += `(?:${glob.slice(i + 2, end).split("|").map(escape).join("|")})?`; i = end; }
    else if (c === "?") out += "[^/]";
    else if (c === "{") { const end = glob.indexOf("}", i); out += `(?:${glob.slice(i + 1, end).split(",").map(part => globRegExp(part).source.slice(1, -1)).join("|")})`; i = end; }
    else if (c === "[") { const end = glob.indexOf("]", i); out += glob.slice(i, end + 1); i = end; }
    else out += escape(c);
  }
  return new RegExp(`^${out}$`);
}
function escape(text) { return text.replace(/[.+^${}()|[\]\\]/g, "\\$&"); }

const VITEST_DEFAULT_INCLUDE = ["**/*.{test,spec}.?(c|m)[jt]s?(x)"];
function stringList(text, key) {
  const match = new RegExp(`\\b${key}\\s*:\\s*\\[([^\\]]*)\\]`).exec(text);
  return match ? [...match[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map(m => m[1]) : undefined;
}

/** The files a `vitest run` reaches: its config's `include` (minus `exclude`) under the config root. */
export function vitestFiles(root, cwd, args, files) {
  let config;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config" || args[i] === "-c") config = args[++i];
    else if (args[i].startsWith("--config=")) config = args[i].slice(9);
  }
  if (!config) config = ["vitest.config.ts", "vitest.config.mts", "vitest.config.js", "vitest.config.mjs", "vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"].find(name => existsSync(join(root, cwd, name)));
  const configPath = config ? posix.normalize(posix.join(cwd, config)) : undefined;
  const text = configPath && existsSync(join(root, configPath)) ? readFileSync(join(root, configPath), "utf8") : "";
  const configRoot = /\broot\s*:\s*["'`]([^"'`]+)["'`]/.exec(text)?.[1];
  const base = posix.normalize(posix.join(configPath ? posix.dirname(configPath) : cwd, configRoot ?? "."));
  const include = (stringList(text, "include") ?? VITEST_DEFAULT_INCLUDE).map(globRegExp);
  const exclude = (stringList(text, "exclude") ?? []).map(globRegExp);
  const filters = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "run" || arg === "vitest") continue;
    if (arg.startsWith("-")) { if (/^--(?:config|root|dir|project|reporter|environment|pool|testTimeout)$/.test(arg) || arg === "-c") i++; continue; }
    filters.push(arg);
  }
  const prefix = base === "." ? "" : `${base}/`;
  return files.filter(file => {
    if (!file.startsWith(prefix) || file.split("/").includes("node_modules")) return false;
    const rel = file.slice(prefix.length);
    return include.some(re => re.test(rel)) && !exclude.some(re => re.test(rel)) && (!filters.length || filters.some(filter => file.includes(filter)));
  });
}

/** Relative specifiers a JS/TS source names: static and dynamic imports, requires and `new URL(.., import.meta.url)`. */
export function relativeSpecifiers(text) {
  const out = new Set();
  const patterns = [
    /\b(?:import|export)\b[^'"`;]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire(?:\.resolve)?\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bnew\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g,
  ];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) if (match[1].startsWith("./") || match[1].startsWith("../")) out.add(match[1]);
  return [...out];
}

function resolveModule(root, fromRel, specifier) {
  const base = posix.normalize(posix.join(posix.dirname(fromRel), specifier.split("?")[0]));
  const candidates = [base, base.replace(/\.(m?)js$/, ".$1ts"), base.replace(/\.js$/, ".tsx"), base.replace(/\.cjs$/, ".cts"),
    ...[".ts", ".tsx", ".mjs", ".cjs", ".js", ".json"].map(ext => base + ext),
    ...["index.ts", "index.tsx", "index.mjs", "index.js"].map(name => `${base}/${name}`)];
  return candidates.find(path => !path.startsWith("..") && existsSync(join(root, path)) && statSync(join(root, path)).isFile());
}

function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }

/** Workspaces of the root manifest: directory (POSIX, repository-relative) -> manifest. */
export function workspaces(root) {
  const manifest = readJson(join(root, "package.json"));
  const out = new Map([[".", manifest]]);
  for (const pattern of manifest.workspaces ?? []) {
    const dirs = pattern.endsWith("/*")
      ? (existsSync(join(root, pattern.slice(0, -2))) ? readdirSync(join(root, pattern.slice(0, -2)), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => `${pattern.slice(0, -2)}/${e.name}`) : [])
      : [pattern];
    for (const dir of dirs) if (existsSync(join(root, dir, "package.json"))) out.set(dir, readJson(join(root, dir, "package.json")));
  }
  return out;
}

/** Trace everything reachable from the root entry scripts. Returns the reached file set and the scripts followed. */
export async function reachable(root) {
  const packages = workspaces(root);
  const byName = new Map([...packages].map(([dir, manifest]) => [manifest.name, dir]));
  const files = walk(root, "", []).filter(path => !path.split("/").some(part => SKIP_DIRS.has(part)));
  const reached = new Set(), scripts = new Set(), queue = [];
  const reach = rel => { if (rel && !reached.has(rel) && existsSync(join(root, rel))) { reached.add(rel); queue.push(rel); } };
  const packageOf = cwd => { for (let dir = cwd; ; dir = posix.dirname(dir)) { if (packages.has(dir)) return dir; if (dir === "." || dir === "") return "."; } };

  const runScript = (dir, name) => {
    const key = `${dir}#${name}`;
    if (scripts.has(key)) return;
    const command = packages.get(dir)?.scripts?.[name];
    if (typeof command !== "string") return;
    scripts.add(key);
    runCommand(command, dir);
  };
  const runCommand = (command, cwd) => {
    for (const words of simpleCommands(command)) {
      while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
      if (!words.length) continue;
      const [program, ...args] = words;
      if (program === "cd" && args[0]) { cwd = posix.normalize(posix.join(cwd, args[0])); continue; }
      if (program === "npm" || program === "pnpm") npm(args, cwd);
      else if (program === "npx") runWords(args.filter(arg => arg !== "--yes" && arg !== "-y"), cwd);
      else runWords(words, cwd);
    }
  };
  const npm = (args, cwd) => {
    let all = false, prefix, script, scripted = false;
    const targets = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--") break;
      if (arg === "--workspaces" || arg === "-ws") all = true;
      else if (arg === "-w" || arg === "--workspace") targets.push(args[++i]);
      else if (arg.startsWith("--workspace=")) targets.push(arg.slice(12));
      else if (arg === "--prefix" || arg === "-C") prefix = args[++i];
      else if (arg.startsWith("--prefix=")) prefix = arg.slice(9);
      else if (arg === "exec" || arg === "x") { runWords(args.slice(i + 1).filter(a => a !== "--"), cwd); return; }
      else if (arg.startsWith("-")) continue;
      else if (!scripted && ["run", "run-script", "rum", "urn"].includes(arg)) scripted = true;
      else if (!scripted && ["test", "t", "tst"].includes(arg)) { script = "test"; break; }
      else if (!scripted && ["start", "stop", "restart"].includes(arg)) { script = arg; break; }
      else if (scripted && !script) script = arg;
    }
    if (!script) return;
    const dirs = all ? [...packages.keys()].filter(dir => dir !== ".")
      : targets.length ? targets.map(target => byName.get(target) ?? posix.normalize(target)).filter(dir => packages.has(dir))
      : [packageOf(prefix ? posix.normalize(posix.join(cwd, prefix)) : cwd)];
    for (const dir of dirs) runScript(dir, script);
  };
  const runWords = (words, cwd) => {
    const [program, ...args] = words;
    if (!program) return;
    if (program === "vitest") { for (const file of vitestFiles(root, cwd, args, files)) reach(file); return; }
    if (program === "node" || program === "tsx" || program === "ts-node") {
      const test = args.includes("--test");
      let script = false;
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith("-")) {
          if (["--import", "--require", "-r", "--loader", "--experimental-loader", "--env-file"].includes(arg)) reachPath(cwd, args[++i]);
          continue;
        }
        if (test) { for (const file of expand(cwd, arg)) reach(file); continue; }
        if (!script) { reachPath(cwd, arg); script = true; }
      }
      return;
    }
    if ((program === "sh" || program === "bash") && args[0] && !args[0].startsWith("-")) { reachPath(cwd, args[0]); return; }
    if (/^\.{0,2}\//.test(program)) reachPath(cwd, program);
  };
  const reachPath = (cwd, path) => { if (path && !path.includes("$")) reach(posix.normalize(posix.join(cwd, path))); };
  const expand = (cwd, pattern) => {
    if (!/[*?{[]/.test(pattern)) return [posix.normalize(posix.join(cwd, pattern))];
    const re = globRegExp(posix.normalize(posix.join(cwd, pattern)));
    return files.filter(file => re.test(file));
  };

  for (const name of ENTRY_SCRIPTS) runScript(".", name);
  while (queue.length) {
    const rel = queue.shift();
    if (rel === "scripts/build-workspaces.mjs") for (const dir of packages.keys()) if (dir !== ".") runScript(dir, "build");
    if (rel === "scripts/run-gate-suites.mjs" && existsSync(join(root, "scripts/lib/gate-test-set.mjs"))) {
      const { discoverGateTestFiles } = await import(pathToFileURL(join(root, "scripts/lib/gate-test-set.mjs")).href);
      for (const file of discoverGateTestFiles({ root })) reach(toPosix(relative(root, resolve(root, file))));
    }
    if (rel === STUDIO_RUNNER && existsSync(join(root, STUDIO_MANIFEST))) {
      for (const entry of readJson(join(root, STUDIO_MANIFEST)).checks ?? []) if (typeof entry.run === "string") runCommand(entry.run, entry.cwd ?? ".");
    }
    if (!CODE.test(rel)) continue;
    const text = readFileSync(join(root, rel), "utf8");
    for (const specifier of relativeSpecifiers(text)) reach(resolveModule(root, rel, specifier));
  }
  return { reached, scripts };
}

/** Validate the exemption file. Returns { exemptions: Map(file -> reason), findings }. */
export function readExemptions(root) {
  const findings = [];
  const exemptions = new Map();
  const path = join(root, EXEMPTIONS_FILE);
  if (!existsSync(path)) return { exemptions, findings };
  const doc = readJson(path);
  if (!Array.isArray(doc.exemptions)) return { exemptions, findings: [{ rule: "exemptions-shape", file: EXEMPTIONS_FILE, message: "expected { exemptions: [{ file, reason }] }" }] };
  for (const entry of doc.exemptions) {
    const file = entry?.file, reason = entry?.reason;
    if (typeof file !== "string" || !file) { findings.push({ rule: "exemption-file", file: EXEMPTIONS_FILE, message: "an exemption has no file" }); continue; }
    if (typeof reason !== "string" || !reason.trim() || /\n/.test(reason)) findings.push({ rule: "exemption-reason", file, message: "an exemption needs a non-empty one-line reason" });
    if (exemptions.has(file)) findings.push({ rule: "exemption-duplicate", file, message: "listed twice" });
    if (!existsSync(join(root, file))) findings.push({ rule: "exemption-missing", file, message: "the exempt file does not exist" });
    else if (!isGoverned(file)) findings.push({ rule: "exemption-out-of-scope", file, message: "the exempt file is not a governed check or test file" });
    exemptions.set(file, reason);
  }
  return { exemptions, findings };
}

export async function orphanFindings(root) {
  const { reached } = await reachable(root);
  const { exemptions, findings } = readExemptions(root);
  const governed = scopeFiles(root).filter(isGoverned);
  for (const file of governed) {
    if (reached.has(file)) { if (exemptions.has(file)) findings.push({ rule: "exemption-stale", file, message: "exempt, but reachable from root check/test: drop the exemption" }); continue; }
    if (!exemptions.has(file)) findings.push({ rule: "orphan", file, message: "not reachable from root `check` or `test`, and not exempt" });
  }
  return { governed: governed.length, reached: governed.filter(file => reached.has(file)).length, exempt: [...exemptions.keys()].filter(file => !reached.has(file)).length, findings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--root");
  const root = resolve(at >= 0 ? args[at + 1] ?? "" : join(here, ".."));
  try {
    const result = await orphanFindings(root);
    if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
    else {
      for (const finding of result.findings) console.log(`${finding.rule}\t${finding.file}\t${finding.message}`);
      console.log(`check:orphan-checks: ${result.governed} governed check/test files, ${result.reached} reachable, ${result.exempt} exempt, ${result.findings.length} finding(s)`);
    }
    process.exitCode = result.findings.length ? 1 : 0;
  } catch (error) {
    console.error(`check:orphan-checks could not run: ${error.message}`);
    process.exitCode = 2;
  }
}
