/**
 * Check `engine.side-door` (rule R-ENGINE-SIDE-DOOR): every write to a workspace's `.clossys/**` or to a slot record
 * goes through the engine API, so it leaves an event in `.clossys/events.jsonl`. A static scan of the shipped source
 * and scripts of the content packages and the Producer (SIDE_DOOR_SCOPE), each file parsed with the TypeScript
 * compiler. A finding is one of:
 *   - write: a file-system write (WRITE_CALLS, or an open with a write flag) whose path argument is derived from
 *     engine vocabulary (a `.clossys` path string, a slot-model path string, a slot-model path helper, or a local
 *     name, function return or exported helper derived from one), outside ENGINE_SURFACE;
 *   - sink: a call, outside ENGINE_SURFACE, that hands a derived path to a function of another file whose parameter
 *     reaches a write (a write wrapper);
 *   - script: a script that calls a record writer of the engine surface (SCRIPT_WRITERS) directly instead of running
 *     the clossys verb that judges its actor;
 *   - unpaired: a file that uses a slot-model file primitive (PAIRED_WRITERS) and appends no ledger event
 *     (PAIRED_APPENDERS), so no event names what it wrote.
 * No allowlist and no baseline: every finding fails the check.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

/** The files and functions that are the engine API: their writes log events. `*` is the whole file. */
export const ENGINE_SURFACE: readonly { readonly file: string; readonly functions: readonly string[] | "*" ; readonly why: string }[] = [
  { file: "packages/producer/src/engine/", functions: "*", why: "the event log, its lock and its derived index" },
  { file: "packages/producer/src/records/slot-write.ts", functions: "*", why: "the slot-model writer: every write appends a ledger event, which it logs" },
  { file: "packages/producer/src/records/pin.ts", functions: ["writePinDoc"], why: "pin and pin-map documents" },
  { file: "packages/producer/src/records/request.ts", functions: ["writeRequest", "createRequest"], why: "work requests (queue-entry/2)" },
  { file: "packages/producer/src/records/library.ts", functions: ["writeElementVersion"], why: "element library versions" },
  { file: "packages/producer/src/queue/entry.ts", functions: ["createQueueEntry", "replaceQueueEntry"], why: "queue entries, the answer write path" },
  { file: "packages/producer/src/loop/runner.ts", functions: ["writeLedger", "revertPin", "saveState", "logRun"], why: "loop run records, the run state and the run's pin revert" },
];
/** Record writers of the engine surface that a script must not call directly. */
export const SCRIPT_WRITERS = Object.freeze([
  "appendEvent", "recordEvent", "writePinDoc", "writeRequest", "writeElementVersion", "createQueueEntry", "replaceQueueEntry",
  "writeCandidate", "writeCandidateBytes", "writePin", "writeConfirm", "writeNotNeeded", "writeTargetDecision", "writeTargetConfirm",
  "writeTargetNotNeeded", "writeSeatDecision", "writeVerdict", "writeReissue", "writeCritique", "writeSlotSeed", "writeSlotOptions",
  "writeSyncedSlot", "replaceModelFile", "createModelFile", "removeModelFile", "moveModelEntry",
]);
/**
 * The slot-model file primitives of records/slot-write.ts: the write of a verb whose records span several files, which
 * then appends its ledger event (and so its engine event) through one of PAIRED_APPENDERS. A file that uses a
 * primitive (a call, or handing it on as a value) without calling an appender writes records no event names.
 */
export const PAIRED_WRITERS = Object.freeze(["replaceModelFile", "createModelFile", "removeModelFile", "moveModelEntry", "dropEmptyModelDir"]);
export const PAIRED_APPENDERS = Object.freeze(["appendIaEvent", "appendSlotDocEvent", "appendRetireCandidate", "appendRetireSlot", "appendCraftEvent", "appendMigrationEvents", "writeSeatDecision"]);
/** The packages whose source and scripts are scanned, and the repository scripts. */
export const SIDE_DOOR_PACKAGES = Object.freeze(["producer", "designer", "writer", "publisher", "director"]);
export const SIDE_DOOR_SCOPE = "packages/<producer|designer|writer|publisher|director>/{src,bin,scripts} and scripts/";

export const WRITE_CALLS = Object.freeze([
  "writeFileSync", "writeFile", "appendFileSync", "appendFile", "unlinkSync", "unlink", "mkdirSync", "mkdir", "rmSync", "rm",
  "rmdirSync", "rmdir", "renameSync", "rename", "copyFileSync", "copyFile", "cpSync", "cp", "createWriteStream", "symlinkSync",
  "symlink", "linkSync", "link", "truncateSync", "truncate", "utimesSync", "utimes", "chmodSync", "chmod",
]);
const OPEN_CALLS = new Set(["openSync", "open"]);
/** Slot-model path helpers (records/slot-model, records/pin.ts, queue/entry.ts): their result is a record path. */
export const HELPERS = Object.freeze(["agentsDir", "agentDir", "iaPath", "slotDir", "slotFile", "pinFile", "candidatesDir", "slotRel", "seatDir", "seatFile", "pinPath", "queueEntryPath", "queueEntriesDir", "requestsDir", "ledgerDir", "producerDir"]);
const MODEL_TREES = ["director", "designer", "writer", "publisher", "producer"];
const AGENT_PATH = new RegExp(`(?:^|/)agents/(?:${MODEL_TREES.join("|")})(?:/|$)`);
const MODEL_FILE = /(?:^|\/)(?:ia|slot|pin|seat|ledger)\.json$|(?:^|\/)candidates(?:\/|$)/;
const ENGINE_PATH = /(?:^|\/)\.clossys(?:\/|$)/;
const PATH_CALLS = new Set(["join", "resolve", "dirname", "normalize", "relative", "basename", "String", "concat", "replace", "replaceAll", "slice", "trim", "toString", "fileURLToPath"]);
const FS_MODULES = new Set(["fs", "node:fs", "fs/promises", "node:fs/promises"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", ".turbo", "coverage", "__fixtures__", "__tests__", "__golden__", "fixtures"]);
const CODE = /\.(?:mjs|cjs|js|jsx|ts|tsx|mts|cts)$/;
const TEST = /\.(?:test|spec)\.(?:mjs|cjs|js|jsx|ts|tsx|mts|cts)$/;

/** Whether a string names an engine path (`.clossys`) or a slot-model path (routes and URLs are not paths). */
export function isEnginePathString(text: string): boolean {
  if (text === ".clossys") return true;
  if (text.includes("://") && !/^file:\/\//i.test(text)) return false;
  const path = text.replace(/^file:\/\//i, "").split(/[?#]/)[0]!;
  if (ENGINE_PATH.test(path)) return true;
  if (path.startsWith("/")) return MODEL_FILE.test(path);
  return AGENT_PATH.test(path) || MODEL_FILE.test(path);
}

const toPosix = (path: string) => path.split(sep).join("/");
/** Repository-relative files in scope. */
export function sideDoorFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (CODE.test(entry.name) && !TEST.test(entry.name) && !entry.name.endsWith(".d.ts")) files.push(toPosix(relative(root, path)));
    }
  };
  for (const pkg of SIDE_DOOR_PACKAGES) for (const sub of ["src", "bin", "scripts"]) walk(join(root, "packages", pkg, sub));
  try { if (statSync(join(root, "scripts")).isDirectory()) walk(join(root, "scripts")); } catch { /* no repository scripts */ }
  return [...new Set(files)].sort();
}

const surfaceOf = (file: string) => ENGINE_SURFACE.find(row => (row.file.endsWith("/") ? file.startsWith(row.file) : file === row.file));
const isScript = (file: string) => file.startsWith("scripts/") || /^packages\/[^/]+\/scripts\//.test(file);

export interface SideDoorFinding { readonly file: string; readonly line: number; readonly kind: "write" | "sink" | "script" | "unpaired"; readonly call: string; readonly text: string }

/** A repository file without its extension. */
const stemOf = (file: string) => file.replace(CODE, "");
/**
 * The stem of the repository module an import names: a relative specifier resolved from the importing file, or a
 * workspace package (`@clossys/<pkg>`, its `src/index`). Other modules have none.
 */
function moduleStem(file: string, specifier: string): string | undefined {
  if (specifier.startsWith(".")) {
    const parts = [...file.split("/").slice(0, -1)];
    for (const part of specifier.split("/")) {
      if (part === "..") parts.pop(); else if (part !== ".") parts.push(part);
    }
    return stemOf(parts.join("/"));
  }
  const pkg = /^@clossys\/([a-z0-9-]+)$/.exec(specifier);
  return pkg ? `packages/${pkg[1]}/src/index` : undefined;
}

/** The name of the function a node sits in (the nearest named one), if any. */
function enclosingNames(node: ts.Node): string[] {
  const names: string[] = [];
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if ((ts.isFunctionDeclaration(at) || ts.isMethodDeclaration(at)) && at.name && ts.isIdentifier(at.name)) names.push(at.name.text);
    else if ((ts.isArrowFunction(at) || ts.isFunctionExpression(at)) && ts.isVariableDeclaration(at.parent) && ts.isIdentifier(at.parent.name)) names.push(at.parent.name.text);
  }
  return names;
}

interface FileFacts {
  readonly findings: SideDoorFinding[];
  /** Exported functions whose return value is an engine path. */
  readonly helpers: string[];
  /** Exported functions whose parameter (by index) reaches a write. */
  readonly sinks: Map<string, Set<number>>;
}

/** One file's facts, given the helper and sink names known across files so far. */
function analyse(file: string, sf: ts.SourceFile, checker: ts.TypeChecker, helpers: ReadonlySet<string>, sinks: ReadonlyMap<string, ReadonlySet<number>>): FileFacts {
  const fsNames = new Map<string, string>();
  const fsNamespaces = new Set<string>();
  /** Named imports from repository modules: local name to the `<module stem>#<exported name>` it binds. */
  const imported = new Map<string, string>();
  const bindImport = (module: string, clause: ts.ImportClause) => {
    const stem = moduleStem(file, module);
    if (stem && clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) imported.set(element.name.text, `${stem}#${(element.propertyName ?? element.name).text}`);
    }
    if (!FS_MODULES.has(module)) return;
    if (clause.name) fsNamespaces.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (!bindings) return;
    if (ts.isNamespaceImport(bindings)) fsNamespaces.add(bindings.name.text);
    else for (const element of bindings.elements) {
      const original = (element.propertyName ?? element.name).text;
      if (original === "promises") fsNamespaces.add(element.name.text);
      else fsNames.set(element.name.text, original);
    }
  };
  const symbolOf = (node: ts.Node) => {
    const symbol = checker.getSymbolAtLocation(node);
    return symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) ?? symbol : symbol;
  };
  const initializers = new Map<ts.Symbol, ts.Expression[]>();
  const returns = new Map<ts.Symbol, ts.Expression[]>();
  const addInit = (name: ts.Identifier, init: ts.Expression) => {
    const symbol = symbolOf(name);
    if (symbol) initializers.set(symbol, [...(initializers.get(symbol) ?? []), init]);
  };
  const visitBindings = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.importClause && ts.isStringLiteral(node.moduleSpecifier)) bindImport(node.moduleSpecifier.text, node.importClause);
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = ts.isAwaitExpression(node.initializer) ? node.initializer.expression : node.initializer;
      if (ts.isCallExpression(init) && init.arguments[0] && ts.isStringLiteralLike(init.arguments[0]) && FS_MODULES.has(init.arguments[0].text)
        && ((ts.isIdentifier(init.expression) && init.expression.text === "require") || init.expression.kind === ts.SyntaxKind.ImportKeyword)) {
        if (ts.isIdentifier(node.name)) fsNamespaces.add(node.name.text);
        else if (ts.isObjectBindingPattern(node.name)) for (const element of node.name.elements) {
          if (!ts.isIdentifier(element.name)) continue;
          const original = element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName.text : element.name.text;
          if (original === "promises") fsNamespaces.add(element.name.text); else fsNames.set(element.name.text, original);
        }
      }
      if (ts.isIdentifier(node.name)) addInit(node.name, node.initializer);
      else if (ts.isObjectBindingPattern(node.name) || ts.isArrayBindingPattern(node.name)) {
        for (const element of node.name.elements) if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) addInit(element.name, node.initializer);
      }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) addInit(node.left, node.right);
    const nameNode = ts.isFunctionDeclaration(node) && node.name ? node.name
      : (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name) ? node.parent.name : undefined;
    if (nameNode && (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.body) {
      const exprs: ts.Expression[] = [];
      if (!ts.isBlock(node.body)) exprs.push(node.body);
      else {
        const collect = (inner: ts.Node): void => { if (ts.isReturnStatement(inner) && inner.expression) exprs.push(inner.expression); if (!ts.isFunctionLike(inner)) ts.forEachChild(inner, collect); };
        ts.forEachChild(node.body, collect);
      }
      const symbol = symbolOf(nameNode);
      if (symbol) returns.set(symbol, [...(returns.get(symbol) ?? []), ...exprs]);
    }
    ts.forEachChild(node, visitBindings);
  };
  visitBindings(sf);

  const calleeOf = (call: ts.CallExpression) => ts.isIdentifier(call.expression) ? call.expression : ts.isPropertyAccessExpression(call.expression) ? call.expression.name : undefined;
  /** Whether `node` is derived from engine vocabulary (or, with `params`, which parameter symbols it reaches). */
  const reach = (node: ts.Node, tainted: ReadonlySet<ts.Symbol>): boolean => {
    let hit = false;
    const walk = (inner: ts.Node): void => {
      if (hit) return;
      if (ts.isStringLiteralLike(inner) && isEnginePathString(inner.text)) { hit = true; return; }
      if (ts.isTemplateExpression(inner) && [inner.head.text, ...inner.templateSpans.map(span => span.literal.text)].some(isEnginePathString)) { hit = true; return; }
      if (ts.isCallExpression(inner)) {
        const callee = calleeOf(inner);
        if (callee && helpers.has(callee.text)) { hit = true; return; }
        const symbol = callee && symbolOf(callee);
        if (symbol && tainted.has(symbol)) { hit = true; return; }
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
  const closure = (seed: Set<ts.Symbol>) => {
    for (let changed = true; changed;) {
      changed = false;
      for (const map of [initializers, returns]) for (const [symbol, exprs] of map) if (!seed.has(symbol) && exprs.some(expr => reach(expr, seed))) { seed.add(symbol); changed = true; }
    }
    return seed;
  };
  const tainted = closure(new Set());

  /** The write calls of the file: [call node, call name, path arguments]. */
  const writes: { node: ts.CallExpression; call: string; args: readonly ts.Expression[] }[] = [];
  const calls: ts.CallExpression[] = [];
  const visitCalls = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      calls.push(node);
      const expr = node.expression;
      let call: string | undefined;
      if (ts.isIdentifier(expr) && fsNames.has(expr.text)) call = fsNames.get(expr.text);
      else if (ts.isPropertyAccessExpression(expr)) {
        const target = expr.expression;
        const base = ts.isIdentifier(target) ? target.text : ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression) && target.name.text === "promises" ? target.expression.text : undefined;
        if (base && fsNamespaces.has(base)) call = expr.name.text;
      }
      const flag = node.arguments[1];
      const writingOpen = call !== undefined && OPEN_CALLS.has(call) && !(flag === undefined || (ts.isStringLiteralLike(flag) && /^r$|^rs$/.test(flag.text)));
      if (call && ((WRITE_CALLS as readonly string[]).includes(call) || writingOpen)) {
        const pair = /^(?:rename|copyFile|cp|symlink|link)/.test(call);
        writes.push({ node, call, args: node.arguments.slice(0, pair ? 2 : 1) });
      }
    }
    ts.forEachChild(node, visitCalls);
  };
  visitCalls(sf);

  const surface = surfaceOf(file);
  const exempt = (node: ts.Node) => surface !== undefined && (surface.functions === "*" || enclosingNames(node).some(name => (surface.functions as readonly string[]).includes(name)));
  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const textOf = (node: ts.Node) => node.getText(sf).replace(/\s+/g, " ").slice(0, 140);
  const findings: SideDoorFinding[] = [];
  for (const write of writes) {
    if (exempt(write.node) || !write.args.some(arg => reach(arg, tainted))) continue;
    findings.push({ file, line: lineOf(write.node), kind: "write", call: write.call, text: textOf(write.node) });
  }
  for (const call of calls) {
    const callee = calleeOf(call);
    if (!callee) continue;
    if (isScript(file) && SCRIPT_WRITERS.includes(callee.text)) { findings.push({ file, line: lineOf(call), kind: "script", call: callee.text, text: textOf(call) }); continue; }
    // A write wrapper is matched through the import that binds it, never by its bare name.
    const bound = ts.isIdentifier(call.expression) ? imported.get(callee.text) : undefined;
    const at = bound === undefined ? undefined : sinks.get(bound);
    if (!at || exempt(call)) continue;
    if ([...at].some(index => call.arguments[index] && reach(call.arguments[index]!, tainted))) findings.push({ file, line: lineOf(call), kind: "sink", call: callee.text, text: textOf(call) });
  }

  // A slot-model primitive used in a file that appends no ledger event.
  if (!surface) {
    const uses: ts.Identifier[] = [];
    let paired = false;
    const visitUses = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && !ts.isImportSpecifier(node.parent) && !ts.isExportSpecifier(node.parent) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node && !ts.isCallExpression(node.parent.parent))) {
        if (PAIRED_WRITERS.includes(node.text)) uses.push(node);
        if (PAIRED_APPENDERS.includes(node.text) && (ts.isCallExpression(node.parent) || (ts.isPropertyAccessExpression(node.parent) && ts.isCallExpression(node.parent.parent)))) paired = true;
      }
      ts.forEachChild(node, visitUses);
    };
    visitUses(sf);
    if (!paired) for (const use of uses) findings.push({ file, line: lineOf(use), kind: "unpaired", call: use.text, text: textOf(use.parent) });
  }

  // Exported helpers (return an engine path) and sinks (a parameter reaches a write), for the other files.
  const exportedHelpers: string[] = [];
  const exportedSinks = new Map<string, Set<number>>();
  for (const statement of sf.statements) {
    if (!(ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword))) continue;
    const decls: { name: ts.Identifier; fn?: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression }[] = ts.isFunctionDeclaration(statement) && statement.name ? [{ name: statement.name, fn: statement }]
      : ts.isVariableStatement(statement) ? statement.declarationList.declarations.filter(decl => ts.isIdentifier(decl.name)).map(decl => ({
        name: decl.name as ts.Identifier,
        ...(decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) ? { fn: decl.initializer } : {}),
      })) : [];
    for (const { name, fn } of decls) {
      const symbol = symbolOf(name);
      if (symbol && tainted.has(symbol) && returns.has(symbol)) exportedHelpers.push(name.text);
      // A surface function is the engine API itself: calling it is the right door, never a sink.
      if (!fn || exempt(fn.body ?? fn) || (surface && surface.functions !== "*" && (surface.functions as readonly string[]).includes(name.text))) continue;
      const inside = (node: ts.Node) => { for (let at: ts.Node | undefined = node; at; at = at.parent) if (at === fn) return true; return false; };
      const own = writes.filter(write => inside(write.node));
      if (!own.length) continue;
      fn.parameters.forEach((param, index) => {
        if (!ts.isIdentifier(param.name)) return;
        const paramSymbol = symbolOf(param.name);
        if (!paramSymbol) return;
        const reached = closure(new Set([paramSymbol]));
        if (own.some(write => write.args.some(arg => reach(arg, reached)))) {
          const key = `${stemOf(file)}#${name.text}`;
          exportedSinks.set(key, new Set([...(exportedSinks.get(key) ?? []), index]));
        }
      });
    }
  }
  return { findings, helpers: exportedHelpers, sinks: exportedSinks };
}

/** Every side-door finding under a repository root (`files` defaults to SIDE_DOOR_SCOPE). */
export function sideDoorFindings(root: string, files = sideDoorFiles(root)): SideDoorFinding[] {
  const options: ts.CompilerOptions = { allowJs: true, noLib: true, noResolve: true, noEmit: true, types: [], jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.Latest };
  const absolute = files.map(file => join(root, file));
  const program = ts.createProgram({ rootNames: absolute, options, host: ts.createCompilerHost(options) });
  const checker = program.getTypeChecker();
  const helpers = new Set<string>(HELPERS);
  const sinks = new Map<string, Set<number>>();
  // Exported helpers and write wrappers are vocabulary in every file; iterate until no new one appears.
  for (;;) {
    const before = helpers.size + [...sinks.values()].reduce((sum, set) => sum + set.size, 0);
    const out: SideDoorFinding[] = [];
    for (const [index, file] of files.entries()) {
      const sf = program.getSourceFile(absolute[index]!);
      if (!sf) throw new Error(`cannot parse ${file}`);
      const facts = analyse(file, sf, checker, helpers, sinks);
      for (const name of facts.helpers) helpers.add(name);
      for (const [name, at] of facts.sinks) sinks.set(name, new Set([...(sinks.get(name) ?? []), ...at]));
      out.push(...facts.findings);
    }
    if (helpers.size + [...sinks.values()].reduce((sum, set) => sum + set.size, 0) === before) {
      return out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
    }
  }
}

export const SIDE_DOOR_MESSAGES: Readonly<Record<SideDoorFinding["kind"], string>> = {
  write: "writes an engine or slot-record path outside the engine API",
  sink: "hands an engine or slot-record path to a write wrapper outside the engine API",
  script: "a script calls a record writer directly; run the clossys verb instead",
  unpaired: "uses a slot-model file primitive in a file that appends no ledger event, so no engine event names the write",
};

/** The check's report: one line per finding, `file:line kind call: message`. */
export function formatSideDoor(findings: readonly SideDoorFinding[]): string {
  return [
    `engine.side-door: ${findings.length ? `fail (${findings.length})` : "pass"}`,
    ...findings.map(finding => `  ${finding.file}:${finding.line} ${finding.kind} ${finding.call}: ${SIDE_DOOR_MESSAGES[finding.kind]} (${finding.text})`),
  ].join("\n");
}
