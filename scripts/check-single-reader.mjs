#!/usr/bin/env node
/**
 * check:single-reader: one reader opens the Git CMS slot model. Every file under a consumer's
 * clossys/agents/<director|designer|writer|publisher>/ tree (ia.json, slot.json, pin.json,
 * candidates/*), and of the Producer seat tree (ia.json, <step>/seat.json), is opened by packages/producer/src/records/slots.ts, the reader, or written by
 * packages/producer/src/records/slot-write.ts, the one writer. Publisher, the agent verbs, Studio
 * and the specimen source import the reader; nothing else touches those paths.
 *
 * Scope: shipped code, that is packages/<pkg>/{src,bin} and packages/producer/studio (its app,
 * lib and components; studio/checks are verification harnesses), outside tests, test fixture
 * (`__fixtures__`, `__tests__`, `__golden__`), dependency and build folders. A `checks` or `fixtures`
 * folder inside shipped code (packages/<pkg>/src/checks) is shipped code and is scanned. Each file is parsed with the TypeScript compiler, and a finding is
 * a file-system call whose path argument is derived from slot-model vocabulary:
 *   - a string naming the model: an "agents" path segment, a non-route string holding
 *     agents/<slot agent or producer>, ia.json, slot.json, pin.json, seat.json, a candidates folder;
 *   - a call to a slot-model path helper (agentsDir, agentDir, iaPath, slotDir, slotFile, pinFile,
 *     candidatesDir, slotRel, seatDir, seatFile);
 *   - a local name whose initializer, or a local function whose return value, is derived from
 *     either of the above (traced to a fixpoint within the file).
 * File-system calls are the node:fs and node:fs/promises reads, stats, listings, watches and
 * writes bound by import or require in that file, plus `git show` through child_process.
 *
 * Usage: node scripts/check-single-reader.mjs [--root DIR] [--json]
 * Exit 0 with no finding, 1 on any finding, 2 on a usage or parse error.
 */
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
/** The reader and the one writer of the slot model, repository-relative. */
export const READER = "packages/producer/src/records/slots.ts";
export const WRITER = "packages/producer/src/records/slot-write.ts";
export const SLOT_AGENTS = Object.freeze(["director", "designer", "writer", "publisher"]);
/** The agent trees the reader owns: the slot trees and the Producer seat tree (slot-model types.ts MODEL_AGENTS). */
export const MODEL_TREES = Object.freeze([...SLOT_AGENTS, "producer"]);
export const HELPERS = Object.freeze(["agentsDir", "agentDir", "iaPath", "slotDir", "slotFile", "pinFile", "candidatesDir", "slotRel", "seatDir", "seatFile"]);
export const FS_CALLS = Object.freeze([
  "readFileSync", "readFile", "existsSync", "exists", "lstatSync", "lstat", "statSync", "stat", "readdirSync", "readdir",
  "opendirSync", "opendir", "watch", "watchFile", "createReadStream", "accessSync", "access", "realpathSync", "realpath",
  "openSync", "open", "writeFileSync", "writeFile", "appendFileSync", "appendFile", "unlinkSync", "unlink", "mkdirSync", "mkdir",
  "rmSync", "rm", "renameSync", "rename", "copyFileSync", "copyFile", "cpSync", "cp", "createWriteStream", "symlinkSync", "symlink",
]);
/** Calls whose result is still the path they were given: node:path builders and string methods. */
const PATH_CALLS = new Set(["join", "resolve", "dirname", "normalize", "relative", "basename", "toNamespacedPath", "String", "concat", "replace", "replaceAll", "slice", "trim", "toString", "split", "fileURLToPath", "pathToFileURL"]);
const FS_MODULES = new Set(["fs", "node:fs", "fs/promises", "node:fs/promises"]);
const CHILD_MODULES = new Set(["child_process", "node:child_process"]);
const CHILD_CALLS = new Set(["execFileSync", "execFile", "spawnSync", "spawn", "execSync", "exec"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", ".turbo", "coverage", "__fixtures__", "__tests__", "__golden__"]);
const CODE = /\.(?:mjs|cjs|js|jsx|ts|tsx|mts|cts)$/;
const TEST = /\.(?:test|spec)\.(?:mjs|cjs|js|jsx|ts|tsx|mts|cts)$/;
const AGENT_PATH = new RegExp(`(?:^|/)agents/(?:${MODEL_TREES.join("|")})(?:/|$)`);
const MODEL_FILE = /(?:^|\/)(?:ia|slot|pin|seat)\.json$|(?:^|\/)candidates(?:\/|$)/;

const toPosix = path => path.split(sep).join("/");

/**
 * Whether a string literal names a slot-model path (routes and URLs are not paths). A URL is a
 * `scheme://` string other than file://; a `?` or `#` only ends the path part, it does not make the
 * string a URL ("agents/designer/hero/pin.json?raw" is still the model).
 */
export function isModelString(text) {
  if (text === "agents") return true;
  const file = /^file:\/\//i.test(text);
  if (text.includes("://") && !file) return false;
  const path = (file ? text.slice(7) : text).split(/[?#]/)[0];
  // A leading slash is a route (/agents/designer/hero) unless it names a model file: a suffix
  // concatenated onto a root ("/agents/publisher/page.home/pin.json") is still a path.
  if (path.startsWith("/") && !file) return MODEL_FILE.test(path);
  return AGENT_PATH.test(path) || MODEL_FILE.test(path);
}

/**
 * An "agents" argument followed by a literal folder that is not a model tree (agents/codex) is not
 * the slot model. The Producer seat tree (agents/producer) is a model tree, so it is a finding.
 */
function otherAgentsFolder(node) {
  if (node.text !== "agents" || !node.parent || !ts.isCallExpression(node.parent)) return false;
  const args = node.parent.arguments, next = args[args.indexOf(node) + 1];
  return Boolean(next && ts.isStringLiteralLike(next) && !MODEL_TREES.includes(next.text));
}

/** Repository-relative files in scope. */
export function scopeFiles(root) {
  const files = [];
  const walk = dir => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (CODE.test(entry.name) && !TEST.test(entry.name) && !entry.name.endsWith(".d.ts")) files.push(toPosix(relative(root, path)));
    }
  };
  let packages = [];
  try { packages = readdirSync(join(root, "packages"), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name); } catch { /* no packages */ }
  for (const pkg of packages.sort()) {
    for (const sub of ["src", "bin"]) walk(join(root, "packages", pkg, sub));
    if (pkg === "producer") for (const sub of ["app", "lib", "components", "server.ts", "server.mjs"]) {
      const path = join(root, "packages", pkg, "studio", sub);
      try { if (statSync(path).isDirectory()) walk(path); else files.push(toPosix(relative(root, path))); } catch { /* absent */ }
    }
  }
  return [...new Set(files)].sort();
}

/** Findings for one parsed file: [{ line, call, text }]. Taint follows symbols, so same-named locals in other scopes stay clean. */
export function analyse(sf, checker, helpers = new Set(HELPERS)) {
  const fsNames = new Map();
  const fsNamespaces = new Set();
  const childNames = new Set();
  const childNamespaces = new Set();
  const bindName = (set, map, original, local) => {
    if (map && FS_CALLS.includes(original)) map.set(local, original);
    else if (set) set.add(local);
  };
  const bind = (module, clause) => {
    const isFs = FS_MODULES.has(module), isChild = CHILD_MODULES.has(module);
    if (!isFs && !isChild) return;
    if (clause.name) (isFs ? fsNamespaces : childNamespaces).add(clause.name.text);
    const bindings = clause.namedBindings;
    if (!bindings) return;
    if (ts.isNamespaceImport(bindings)) (isFs ? fsNamespaces : childNamespaces).add(bindings.name.text);
    else for (const element of bindings.elements) {
      const original = (element.propertyName ?? element.name).text;
      if (isFs && original === "promises") fsNamespaces.add(element.name.text);
      else if (isFs) bindName(undefined, fsNames, original, element.name.text);
      else if (CHILD_CALLS.has(original)) childNames.add(element.name.text);
    }
  };
  const moduleOf = init => {
    if (ts.isAwaitExpression(init)) init = init.expression;
    if (!ts.isCallExpression(init) || !init.arguments.length || !ts.isStringLiteralLike(init.arguments[0])) return undefined;
    const isRequire = ts.isIdentifier(init.expression) && init.expression.text === "require";
    return isRequire || init.expression.kind === ts.SyntaxKind.ImportKeyword ? init.arguments[0].text : undefined;
  };
  const symbolOf = node => {
    const symbol = checker.getSymbolAtLocation(node);
    return symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) ?? symbol : symbol;
  };

  const initializers = new Map();
  const returns = new Map();
  const calls = [];
  const paramsOf = symbol => {
    let decl = symbol?.valueDeclaration;
    if (decl && ts.isVariableDeclaration(decl) && decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) decl = decl.initializer;
    return decl && ts.isFunctionLike(decl) && decl.getSourceFile() === sf ? decl.parameters : undefined;
  };
  const addInit = (nameNode, init) => {
    const symbol = symbolOf(nameNode);
    if (symbol) initializers.set(symbol, [...(initializers.get(symbol) ?? []), init]);
  };
  const visitBindings = node => {
    if (ts.isImportDeclaration(node) && node.importClause && ts.isStringLiteral(node.moduleSpecifier)) bind(node.moduleSpecifier.text, node.importClause);
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const module = moduleOf(node.initializer);
      if (module && (FS_MODULES.has(module) || CHILD_MODULES.has(module))) {
        const isFs = FS_MODULES.has(module);
        if (ts.isIdentifier(node.name)) (isFs ? fsNamespaces : childNamespaces).add(node.name.text);
        else if (ts.isObjectBindingPattern(node.name)) for (const element of node.name.elements) {
          if (!ts.isIdentifier(element.name)) continue;
          const original = element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName.text : element.name.text;
          if (isFs && original === "promises") fsNamespaces.add(element.name.text);
          else if (isFs) bindName(undefined, fsNames, original, element.name.text);
          else if (CHILD_CALLS.has(original)) childNames.add(element.name.text);
        }
      }
      if (ts.isIdentifier(node.name)) addInit(node.name, node.initializer);
      else for (const element of node.name.elements ?? []) if (element.name && ts.isIdentifier(element.name)) addInit(element.name, node.initializer);
    }
    if (ts.isCallExpression(node)) {
      const callee = ts.isIdentifier(node.expression) ? node.expression : ts.isPropertyAccessExpression(node.expression) ? node.expression.name : undefined;
      const params = callee && paramsOf(symbolOf(callee));
      if (params) node.arguments.forEach((arg, index) => {
        const param = params[Math.min(index, params.length - 1)];
        if (param && ts.isIdentifier(param.name) && (index < params.length || param.dotDotDotToken)) calls.push({ param: symbolOf(param.name), arg });
      });
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) addInit(node.left, node.right);
    const nameNode = ts.isFunctionDeclaration(node) && node.name ? node.name
      : (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name) ? node.parent.name
      : ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) ? node.name : undefined;
    if (nameNode && node.body) {
      const exprs = [];
      if (!ts.isBlock(node.body)) exprs.push(node.body);
      else {
        const collect = inner => { if (ts.isReturnStatement(inner) && inner.expression) exprs.push(inner.expression); if (!ts.isFunctionLike(inner)) ts.forEachChild(inner, collect); };
        ts.forEachChild(node.body, collect);
      }
      const symbol = symbolOf(nameNode);
      if (symbol) returns.set(symbol, [...(returns.get(symbol) ?? []), ...exprs]);
    }
    ts.forEachChild(node, visitBindings);
  };
  visitBindings(sf);

  const tainted = new Set();
  const derived = node => {
    let hit = false;
    const walk = inner => {
      if (hit) return;
      if (ts.isStringLiteralLike(inner) && isModelString(inner.text) && !otherAgentsFolder(inner)) { hit = true; return; }
      if (ts.isTemplateExpression(inner) && [inner.head.text, ...inner.templateSpans.map(span => span.literal.text)].some(isModelString)) { hit = true; return; }
      if (ts.isCallExpression(inner)) {
        const callee = ts.isIdentifier(inner.expression) ? inner.expression : ts.isPropertyAccessExpression(inner.expression) ? inner.expression.name : undefined;
        if (callee && helpers.has(callee.text)) { hit = true; return; }
        const symbol = callee && symbolOf(callee);
        if (symbol && tainted.has(symbol)) { hit = true; return; }
        // A path flows through path builders and string methods; any other call returns data.
        if (!callee || !PATH_CALLS.has(callee.text)) { walk(inner.expression); return; }
      }
      if (ts.isIdentifier(inner) && !(ts.isPropertyAccessExpression(inner.parent) && inner.parent.name === inner)) {
        const symbol = symbolOf(inner);
        if (symbol && tainted.has(symbol)) { hit = true; return; }
      }
      if (ts.isFunctionLike(inner) && inner !== node) return;
      ts.forEachChild(inner, walk);
    };
    walk(node);
    return hit;
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const map of [initializers, returns]) for (const [symbol, exprs] of map) if (!tainted.has(symbol) && exprs.some(derived)) { tainted.add(symbol); changed = true; }
    for (const { param, arg } of calls) if (param && !tainted.has(param) && derived(arg)) { tainted.add(param); changed = true; }
  }

  const findings = [];
  const visitCalls = node => {
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      let call;
      if (ts.isIdentifier(expr) && fsNames.has(expr.text)) call = fsNames.get(expr.text);
      else if (ts.isPropertyAccessExpression(expr) && FS_CALLS.includes(expr.name.text)) {
        const target = expr.expression;
        const base = ts.isIdentifier(target) ? target.text : ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression) && target.name.text === "promises" ? target.expression.text : undefined;
        if (base && fsNamespaces.has(base)) call = expr.name.text;
      }
      let gitShow = false;
      const childCall = ts.isIdentifier(expr) ? childNames.has(expr.text)
        : ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression) && childNamespaces.has(expr.expression.text) && CHILD_CALLS.has(expr.name.text);
      if (childCall) gitShow = node.arguments.some(arg => /\bshow\b/.test(arg.getText(sf))) && node.arguments.some(arg => /\bgit\b/.test(arg.getText(sf)));
      if (call || gitShow) {
        const pair = call && /^(?:rename|copyFile|cp|symlink)/.test(call);
        const args = call ? node.arguments.slice(0, pair ? 2 : 1) : node.arguments;
        if (args.some(derived)) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          findings.push({ line: line + 1, call: call ?? "git show", text: node.getText(sf).replace(/\s+/g, " ").slice(0, 140) });
        }
      }
    }
    ts.forEachChild(node, visitCalls);
  };
  visitCalls(sf);
  const exported = [];
  for (const statement of sf.statements) {
    const isExported = ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword);
    if (!isExported) continue;
    const names = ts.isFunctionDeclaration(statement) && statement.name ? [statement.name]
      : ts.isVariableStatement(statement) ? statement.declarationList.declarations.map(decl => decl.name).filter(ts.isIdentifier) : [];
    for (const name of names) { const symbol = symbolOf(name); if (symbol && tainted.has(symbol) && returns.has(symbol)) exported.push(name.text); }
  }
  return Object.assign(findings, { exported });
}

/** Parse files into one program (no lib, no module resolution) so each file gets symbol-level taint. */
export function analyseFiles(root, files) {
  const options = { allowJs: true, noLib: true, noResolve: true, noEmit: true, types: [], jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.Latest };
  const host = ts.createCompilerHost(options);
  const absolute = files.map(file => join(root, file));
  const program = ts.createProgram({ rootNames: absolute, options, host });
  const checker = program.getTypeChecker();
  // Exported path helpers (a function whose return value is a slot-model path) are vocabulary
  // in every importing file; iterate until no new helper appears.
  const helpers = new Set(HELPERS);
  for (;;) {
    const out = [];
    const before = helpers.size;
    for (const [index, file] of files.entries()) {
      const sf = program.getSourceFile(absolute[index]);
      if (!sf) throw new Error(`cannot parse ${file}`);
      const found = analyse(sf, checker, helpers);
      for (const name of found.exported) helpers.add(name);
      for (const finding of found) out.push({ file, ...finding });
    }
    if (helpers.size === before) return out;
  }
}

/** All findings under a repository root: [{ file, line, call, text }]. */
export function check(root) {
  return analyseFiles(root, scopeFiles(root).filter(file => file !== READER && file !== WRITER));
}

function main(argv) {
  let root = resolve(here, "..");
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root" && argv[i + 1]) root = resolve(argv[++i]);
    else if (argv[i] === "--json") json = true;
    else { console.error(`check:single-reader: unknown argument ${argv[i]}`); return 2; }
  }
  let findings;
  try { findings = check(root); } catch (error) { console.error(`check:single-reader: ${error.message}`); return 2; }
  if (json) console.log(JSON.stringify({ reader: READER, writer: WRITER, findings }, null, 2));
  else {
    for (const finding of findings) console.log(`${finding.file}:${finding.line}: ${finding.call} opens a slot-model path outside the reader: ${finding.text}`);
    console.log(findings.length
      ? `check:single-reader: ${findings.length} finding(s) in ${new Set(findings.map(finding => finding.file)).size} file(s); import ${READER} instead`
      : `check:single-reader: ok; only ${READER} reads and ${WRITER} writes the slot model`);
  }
  return findings.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
