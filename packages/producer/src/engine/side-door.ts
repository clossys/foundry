/**
 * Check `engine.side-door` (rule R-ENGINE-SIDE-DOOR): every write to a workspace's `.clossys/**` or to a slot record
 * goes through the engine API, so it leaves an event in `.clossys/events.jsonl`. A static scan of the shipped source
 * and scripts of the content packages and the Producer (SIDE_DOOR_SCOPE), each file parsed with the TypeScript
 * compiler. A finding is one of:
 *   - write: a file-system write (WRITE_CALLS, or an open with a write flag) whose path argument is derived from
 *     engine vocabulary (a `.clossys` path string, a slot-model path string, a slot-model path helper, or a local
 *     name, function return, exported helper or exported constant derived from one, through any import or
 *     re-export), outside ENGINE_SURFACE. A path built from pieces (`".clos" + "sys"`, a template, `join` or
 *     `resolve` segments, `[...].join("/")`, constants of this file or imported ones) is judged by its folded text;
 *     a piece it cannot know folds to a placeholder that names no path;
 *   - sink: a call, outside ENGINE_SURFACE, that hands a derived path to a function (of this file or, through its
 *     import, of another) whose parameter reaches a write (a write wrapper);
 *   - script: a script that calls a record writer of the engine surface (SCRIPT_WRITERS) directly instead of running
 *     the clossys verb that judges its actor;
 *   - unpaired: a file that uses a slot-model file primitive (PAIRED_WRITERS) and appends no ledger event
 *     (PAIRED_APPENDERS), so no event names what it wrote.
 * No allowlist and no baseline: every finding fails the check.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

/**
 * A surface file whose writes are proved per call: a write is the engine's only inside a record transaction (a
 * function passed to one of `wrappers`, or a local function every reference to which sits in one), or in the body of
 * one of `primitives` (a slot-model file primitive, paired at its callers by the `unpaired` rule, or the lock that
 * the transaction holds). Every other write in the file is a finding.
 */
export interface SurfaceTransactions { readonly wrappers: readonly string[]; readonly primitives: readonly string[] }
/** The files and functions that are the engine API: their writes log events. `*` is the whole file. */
export const ENGINE_SURFACE: readonly { readonly file: string; readonly functions: readonly string[] | "*" | SurfaceTransactions; readonly why: string }[] = [
  { file: "packages/producer/src/engine/", functions: "*", why: "the event log, its lock and its derived index" },
  {
    file: "packages/producer/src/records/slot-write.ts",
    functions: { wrappers: ["withDirLock", "slotLocked", "agentLocked", "deferEvents"], primitives: ["replaceModelFile", "createModelFile", "removeModelFile", "moveModelEntry", "dropEmptyModelDir", "withDirLock"] },
    why: "the slot-model writer, per call: a write inside a record transaction (withDirLock, slotLocked, agentLocked, deferEvents), whose ledger event it logs, or in a paired slot-model primitive or the lock itself",
  },
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
/**
 * Folders skipped at any depth of the scanned folders: installed dependencies, fixtures and test-only trees. Build
 * output (`dist`, `build`) sits at a package root, outside the scanned folders, so it is never walked; a folder named
 * `build` (or `dist`) inside `src`, `bin` or `scripts` is source and is scanned.
 */
export const SIDE_DOOR_SKIPPED_DIRS = Object.freeze(["node_modules", "__fixtures__", "__tests__", "__golden__", "fixtures"]);
const SKIP_DIRS = new Set<string>(SIDE_DOOR_SKIPPED_DIRS);
/** What the scan leaves out, as engine.md states it. */
export const SIDE_DOOR_EXCLUDED = `test files (\`*.test.*\`, \`*.spec.*\`), declaration files (\`*.d.ts\`) and folders named ${SIDE_DOOR_SKIPPED_DIRS.map(name => `\`${name}\``).join(", ")} at any depth. Build output at a package root (\`dist\`, \`build\`) is outside the scanned folders; a \`build\` folder inside \`src\` is source and is scanned.`;
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

const isTransactions = (functions: readonly string[] | "*" | SurfaceTransactions): functions is SurfaceTransactions => functions !== "*" && !Array.isArray(functions);
/** A surface row's functions as a table cell (engine.md). */
export const surfaceFunctions = (functions: readonly string[] | "*" | SurfaceTransactions): string =>
  functions === "*" ? "all" : isTransactions(functions) ? `writes inside ${functions.wrappers.join(", ")}; ${functions.primitives.join(", ")}` : (functions as readonly string[]).join(", ");
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
  /** Exported constants (`<module stem>#<name>`) derived from engine vocabulary. */
  readonly constants: string[];
  /** Exported string constants whose text folds whole (`<module stem>#<name>` to the text). */
  readonly values: Map<string, string>;
  /** Re-exports: `<module stem>#<name>` this module exports to the `<module stem>#<name>` it binds, and `export *` stems. */
  readonly reexports: Map<string, string>;
  readonly stars: string[];
}

/** Cross-file vocabulary: helpers by name, sinks, constants and folded values by `<module stem>#<name>`. */
interface Vocabulary {
  readonly helpers: ReadonlySet<string>;
  readonly sinks: ReadonlyMap<string, ReadonlySet<number>>;
  readonly constants: ReadonlySet<string>;
  readonly values: ReadonlyMap<string, string>;
  /** `<module stem>#<name>` to the binding it re-exports, through every `export {...} from` and `export * from`. */
  readonly resolve: (key: string) => string;
}

/** The placeholder a piece of a path the fold cannot know becomes: it names no path. */
const UNKNOWN = "\0";

/** Whether a node only wraps an expression for the type checker or for grouping: `(x)`, `x as T`, `x satisfies T`, `x!`, `<T>x`. */
const isWrapper = (node: ts.Node): node is ts.ParenthesizedExpression | ts.AsExpression | ts.SatisfiesExpression | ts.NonNullExpression | ts.TypeAssertion =>
  ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node);
/** An expression with every such wrapper removed, so a cast never hides an fs binding, a path or a callee. */
const strip = (node: ts.Expression): ts.Expression => {
  let at = node;
  while (isWrapper(at)) at = at.expression;
  return at;
};
/** The variable declaration a function expression initializes, through any wrappers around it. */
const declarationOf = (fn: ts.Node): ts.VariableDeclaration | undefined => {
  let at = fn;
  while (at.parent && isWrapper(at.parent)) at = at.parent;
  return at.parent && ts.isVariableDeclaration(at.parent) && at.parent.initializer === at ? at.parent : undefined;
};
/** The object-literal property name a function expression initializes (`{ rename: (from, to) => ... }`), through any wrappers. */
const propertyOf = (fn: ts.Node): ts.Identifier | undefined => {
  let at = fn;
  while (at.parent && isWrapper(at.parent)) at = at.parent;
  return at.parent && ts.isPropertyAssignment(at.parent) && at.parent.initializer === at && ts.isIdentifier(at.parent.name) ? at.parent.name : undefined;
};
/** The member a property or string-literal element access names (`fs.writeFileSync`, `fs["writeFileSync"]`). */
const memberName = (node: ts.Expression): string | undefined => ts.isPropertyAccessExpression(node) ? node.name.text
  : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(strip(node.argumentExpression)) ? (strip(node.argumentExpression) as ts.StringLiteralLike).text : undefined;

/** One file's facts, given the helper and sink names known across files so far. */
function analyse(file: string, sf: ts.SourceFile, checker: ts.TypeChecker, vocabulary: Vocabulary): FileFacts {
  const { helpers, sinks } = vocabulary;
  const fsNames = new Map<string, string>();
  const fsNamespaces = new Set<string>();
  /** Named imports from repository modules: local name to the `<module stem>#<exported name>` it binds. */
  const imported = new Map<string, string>();
  /** Namespace imports of repository modules (`import * as chain from "./chain.js"`): local name to the module stem. */
  const namespaces = new Map<string, string>();
  const reexports = new Map<string, string>();
  const stars: string[] = [];
  const bindImport = (module: string, clause: ts.ImportClause) => {
    const stem = moduleStem(file, module);
    if (stem && clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) imported.set(element.name.text, `${stem}#${(element.propertyName ?? element.name).text}`);
    }
    if (stem && clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) namespaces.set(clause.namedBindings.name.text, stem);
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
  /** Local names bound to a `createRequire(...)` result: they load modules as `require` does. */
  const requireNames = new Set<string>(["require"]);
  const isCreateRequire = (expr: ts.Expression): boolean => {
    const node = strip(expr);
    if (!ts.isCallExpression(node)) return false;
    const callee = strip(node.expression);
    return (ts.isIdentifier(callee) && callee.text === "createRequire") || memberName(callee) === "createRequire";
  };
  const isRequire = (expr: ts.Expression): boolean => { const node = strip(expr); return (ts.isIdentifier(node) && requireNames.has(node.text)) || isCreateRequire(node); };
  /**
   * Whether an expression is an fs module namespace, through any wrappers: a `require` (or `createRequire(...)`) or
   * `import()` of an fs module, awaited or not, a name bound to one, or its `.default` or `.promises`.
   */
  const isFsNamespace = (expr: ts.Expression): boolean => {
    let node = strip(expr);
    if (ts.isAwaitExpression(node)) node = strip(node.expression);
    if (ts.isCallExpression(node)) {
      const arg = node.arguments[0] && strip(node.arguments[0]);
      return arg !== undefined && ts.isStringLiteralLike(arg) && FS_MODULES.has(arg.text) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || isRequire(node.expression));
    }
    if (ts.isIdentifier(node)) return fsNamespaces.has(node.text);
    const member = memberName(node);
    return (member === "default" || member === "promises") && isFsNamespace((node as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression);
  };
  /** The fs member an expression names (`fs.writeFileSync`, `fs["rmSync"]`, `require("fs").rename`), through any wrappers. */
  const fsMemberOf = (expr: ts.Expression): string | undefined => {
    const node = strip(expr);
    const member = memberName(node);
    return member !== undefined && isFsNamespace((node as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression) ? member : undefined;
  };
  /**
   * The fs function an expression names, through wrappers: an fs member, a name bound to one, or either side of a
   * choice between alternatives (`saved ?? fs.renameSync`, `ok ? fs.rmSync : skip`).
   */
  const fsCallOf = (expr: ts.Expression): string | undefined => {
    const node = strip(expr);
    if (ts.isIdentifier(node)) return fsNames.get(node.text);
    if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken)) return fsCallOf(node.left) ?? fsCallOf(node.right);
    if (ts.isConditionalExpression(node)) return fsCallOf(node.whenTrue) ?? fsCallOf(node.whenFalse);
    return fsMemberOf(node);
  };
  /** Binds `name` to what `init` holds: an fs namespace, a destructured set of fs members, one fs member, or a `createRequire` result. */
  const bindFs = (name: ts.BindingName | ts.Expression, init: ts.Expression) => {
    if (isFsNamespace(init)) {
      if (ts.isIdentifier(name)) fsNamespaces.add(name.text);
      else if (ts.isObjectBindingPattern(name)) for (const element of name.elements) {
        if (!ts.isIdentifier(element.name)) continue;
        const original = element.propertyName && (ts.isIdentifier(element.propertyName) || ts.isStringLiteralLike(element.propertyName)) ? element.propertyName.text : element.name.text;
        if (original === "promises" || original === "default") fsNamespaces.add(element.name.text); else fsNames.set(element.name.text, original);
      }
      return;
    }
    if (!ts.isIdentifier(name)) return;
    if (isCreateRequire(init)) { requireNames.add(name.text); return; }
    const member = fsCallOf(init);
    if (member !== undefined) fsNames.set(name.text, member);
  };
  const visitBindings = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.importClause && ts.isStringLiteral(node.moduleSpecifier)) bindImport(node.moduleSpecifier.text, node.importClause);
    // `import fs = require("node:fs")`.
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteralLike(node.moduleReference.expression)
      && FS_MODULES.has(node.moduleReference.expression.text)) fsNamespaces.add(node.name.text);
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const stem = moduleStem(file, node.moduleSpecifier.text);
      if (stem && !node.exportClause) stars.push(stem);
      else if (stem && node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) reexports.set(`${stemOf(file)}#${element.name.text}`, `${stem}#${(element.propertyName ?? element.name).text}`);
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      bindFs(node.name, node.initializer);
      if (ts.isIdentifier(node.name)) addInit(node.name, node.initializer);
      else if (ts.isObjectBindingPattern(node.name) || ts.isArrayBindingPattern(node.name)) {
        for (const element of node.name.elements) if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) addInit(element.name, node.initializer);
      }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) { bindFs(node.left, node.right); addInit(node.left, node.right); }
    const holder = declarationOf(node);
    const nameNode = ts.isFunctionDeclaration(node) && node.name ? node.name
      : (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && holder && ts.isIdentifier(holder.name) ? holder.name : undefined;
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

  const calleeOf = (call: ts.CallExpression) => { const expr = strip(call.expression); return ts.isIdentifier(expr) ? expr : ts.isPropertyAccessExpression(expr) ? expr.name : undefined; };
  /** The cross-file binding (`<module stem>#<name>`, re-exports followed) an identifier or namespace member names. */
  const bindingOf = (node: ts.Node): string | undefined => {
    if (ts.isIdentifier(node) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) {
      const key = imported.get(node.text);
      return key === undefined ? undefined : vocabulary.resolve(key);
    }
    if (ts.isPropertyAccessExpression(node)) {
      const receiver = strip(node.expression);
      if (ts.isIdentifier(receiver) && namespaces.has(receiver.text)) return vocabulary.resolve(`${namespaces.get(receiver.text)!}#${node.name.text}`);
    }
    return undefined;
  };
  /** A local const's one initializer, for the fold. */
  const constInit = (node: ts.Identifier): ts.Expression | undefined => {
    const symbol = symbolOf(node);
    const decl = symbol?.valueDeclaration;
    if (!decl || !ts.isVariableDeclaration(decl) || !decl.initializer || !ts.isIdentifier(decl.name)) return undefined;
    return ts.isVariableDeclarationList(decl.parent) && decl.parent.flags & ts.NodeFlags.Const ? decl.initializer : undefined;
  };
  /**
   * The text a path expression folds to: literals, templates, `+`, `join`/`resolve` segments (joined by `/`),
   * `[...].join(sep)`, consts of this file and imported constants; anything else is UNKNOWN.
   */
  const fold = (node: ts.Expression, depth = 0): string => {
    if (depth > 12) return UNKNOWN;
    const inner = strip(node);
    if (inner !== node) return fold(inner, depth + 1);
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map(span => fold(span.expression, depth + 1) + span.literal.text).join("");
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return fold(node.left, depth + 1) + fold(node.right, depth + 1);
    if (ts.isCallExpression(node)) {
      const callee = calleeOf(node);
      const target = strip(node.expression);
      const array = ts.isPropertyAccessExpression(target) ? strip(target.expression) : undefined;
      if (callee && (callee.text === "join" || callee.text === "resolve") && !(array && ts.isArrayLiteralExpression(array))) {
        return node.arguments.map(arg => fold(arg, depth + 1)).join("/");
      }
      if (callee?.text === "join" && array && ts.isArrayLiteralExpression(array)) {
        const sep = node.arguments[0] ? fold(node.arguments[0], depth + 1) : ",";
        return array.elements.map(element => ts.isSpreadElement(element) ? UNKNOWN : fold(element, depth + 1)).join(sep);
      }
      return UNKNOWN;
    }
    const binding = bindingOf(node);
    if (binding !== undefined) return vocabulary.values.get(binding) ?? UNKNOWN;
    if (ts.isIdentifier(node)) { const init = constInit(node); return init ? fold(init, depth + 1) : UNKNOWN; }
    return UNKNOWN;
  };
  const folds = (node: ts.Node) => ts.isBinaryExpression(node) || ts.isTemplateExpression(node) || (ts.isCallExpression(node) && ["join", "resolve"].includes(calleeOf(node)?.text ?? ""));
  /** Whether `node` is derived from engine vocabulary (or, with `params`, which parameter symbols it reaches). */
  const reach = (node: ts.Node, tainted: ReadonlySet<ts.Symbol>): boolean => {
    let hit = false;
    const walk = (inner: ts.Node): void => {
      if (hit) return;
      if (ts.isStringLiteralLike(inner) && isEnginePathString(inner.text)) { hit = true; return; }
      if (ts.isTemplateExpression(inner) && [inner.head.text, ...inner.templateSpans.map(span => span.literal.text)].some(isEnginePathString)) { hit = true; return; }
      if (folds(inner) && isEnginePathString(fold(inner as ts.Expression))) { hit = true; return; }
      const binding = bindingOf(inner);
      if (binding !== undefined && vocabulary.constants.has(binding)) { hit = true; return; }
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
      const call = fsCallOf(node.expression);
      const flag = node.arguments[1] && strip(node.arguments[1]);
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
  const transactions = surface && isTransactions(surface.functions) ? surface.functions : undefined;
  const inTransaction = transactions === undefined ? () => false : transactionContexts(sf, transactions, symbolOf);
  const exempt = (node: ts.Node) => surface !== undefined && (surface.functions === "*"
    || (transactions !== undefined ? inTransaction(node) : enclosingNames(node).some(name => (surface.functions as readonly string[]).includes(name))));
  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const textOf = (node: ts.Node) => node.getText(sf).replace(/\s+/g, " ").slice(0, 140);
  const findings: SideDoorFinding[] = [];
  for (const write of writes) {
    if (exempt(write.node) || !write.args.some(arg => reach(arg, tainted))) continue;
    findings.push({ file, line: lineOf(write.node), kind: "write", call: write.call, text: textOf(write.node) });
  }
  // Write wrappers of this file: a function whose parameter (by index) reaches a write, or a wrapper call at its
  // wrapped index, outside the engine surface's exemptions. A call to one that hands it a derived path is a sink
  // finding, like a call to an imported wrapper.
  const within = (fn: ts.Node, node: ts.Node) => { for (let at: ts.Node | undefined = node; at; at = at.parent) if (at === fn) return true; return false; };
  const localFns: { symbol: ts.Symbol; fn: ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression; params: () => (Set<ts.Symbol> | undefined)[] }[] = [];
  const collectFns = (node: ts.Node): void => {
    const holder = declarationOf(node);
    const name = (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name && ts.isIdentifier(node.name) ? node.name
      : (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) ? (holder && ts.isIdentifier(holder.name) ? holder.name : propertyOf(node)) : undefined;
    const symbol = name && symbolOf(name);
    if (symbol && (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.parameters.length) {
      let cached: (Set<ts.Symbol> | undefined)[] | undefined;
      const fn = node;
      localFns.push({ symbol, fn, params: () => cached ??= fn.parameters.map(param => { const at = ts.isIdentifier(param.name) ? symbolOf(param.name) : undefined; return at ? closure(new Set([at])) : undefined; }) });
    }
    ts.forEachChild(node, collectFns);
  };
  collectFns(sf);
  const localSinks = new Map<ts.Symbol, Set<number>>();
  /** The local function a call names: by its name, or (`raw.rename(...)`) by the object-literal property or method it reads. */
  const localSinkOf = (call: ts.CallExpression) => {
    const target = strip(call.expression);
    const member = ts.isPropertyAccessExpression(target) ? symbolOf(target.name) : undefined;
    const symbol = ts.isIdentifier(target) ? symbolOf(target) : member && (checker.getRootSymbols(member)[0] ?? member);
    return symbol && localSinks.get(symbol);
  };
  for (let grew = true; grew;) {
    grew = false;
    for (const { symbol, fn, params } of localFns) {
      const ownWrites = writes.filter(write => within(fn, write.node) && !exempt(write.node));
      const ownCalls = calls.filter(call => within(fn, call) && !exempt(call) && localSinkOf(call) !== undefined);
      if (!ownWrites.length && !ownCalls.length) continue;
      params().forEach((reached, index) => {
        if (!reached || localSinks.get(symbol)?.has(index)) return;
        if (ownWrites.some(write => write.args.some(arg => reach(arg, reached)))
          || ownCalls.some(call => [...localSinkOf(call)!].some(at => call.arguments[at] && reach(call.arguments[at]!, reached)))) {
          localSinks.set(symbol, new Set([...(localSinks.get(symbol) ?? []), index]));
          grew = true;
        }
      });
    }
  }
  for (const call of calls) {
    const callee = calleeOf(call);
    if (!callee) continue;
    const local = localSinkOf(call);
    if (local && !exempt(call) && [...local].some(index => call.arguments[index] && reach(call.arguments[index]!, tainted))) {
      findings.push({ file, line: lineOf(call), kind: "sink", call: callee.text, text: textOf(call) });
      continue;
    }
    if (isScript(file) && SCRIPT_WRITERS.includes(callee.text)) { findings.push({ file, line: lineOf(call), kind: "script", call: callee.text, text: textOf(call) }); continue; }
    // A write wrapper is matched through the import that binds it, never by its bare name.
    const target = strip(call.expression);
    const bound = ts.isIdentifier(target) ? imported.get(callee.text) : undefined;
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
  const exportedConstants: string[] = [];
  const exportedValues = new Map<string, string>();
  const exportConstant = (name: string, symbol: ts.Symbol | undefined, init: ts.Expression | undefined) => {
    const key = `${stemOf(file)}#${name}`;
    if (symbol && tainted.has(symbol)) exportedConstants.push(key);
    if (init) { const text = fold(init); if (!text.includes(UNKNOWN)) exportedValues.set(key, text); }
  };
  for (const statement of sf.statements) {
    // `export { NAME }` and `export { NAME as OTHER }` of a local const.
    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        const local = element.propertyName ?? element.name;
        const symbol = symbolOf(local);
        const decl = symbol?.valueDeclaration;
        if (decl && ts.isVariableDeclaration(decl) && !(decl.initializer && (ts.isArrowFunction(strip(decl.initializer)) || ts.isFunctionExpression(strip(decl.initializer))))) exportConstant(element.name.text, symbol, decl.initializer);
      }
    }
  }
  for (const statement of sf.statements) {
    if (!(ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword))) continue;
    const decls: { name: ts.Identifier; fn?: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression }[] = ts.isFunctionDeclaration(statement) && statement.name ? [{ name: statement.name, fn: statement }]
      : ts.isVariableStatement(statement) ? statement.declarationList.declarations.filter(decl => ts.isIdentifier(decl.name)).map(decl => ({
        name: decl.name as ts.Identifier,
        ...(decl.initializer && (ts.isArrowFunction(strip(decl.initializer)) || ts.isFunctionExpression(strip(decl.initializer))) ? { fn: strip(decl.initializer) as ts.ArrowFunction | ts.FunctionExpression } : {}),
      })) : [];
    for (const { name, fn } of decls) {
      const symbol = symbolOf(name);
      if (symbol && tainted.has(symbol) && returns.has(symbol)) exportedHelpers.push(name.text);
      if (!fn && ts.isVariableStatement(statement)) exportConstant(name.text, symbol, statement.declarationList.declarations.find(decl => decl.name === name)?.initializer);
      // A surface function is the engine API itself: calling it is the right door, never a sink.
      if (!fn || exempt(fn.body ?? fn) || (surface && Array.isArray(surface.functions) && (surface.functions as readonly string[]).includes(name.text))) continue;
      const inside = (node: ts.Node) => { for (let at: ts.Node | undefined = node; at; at = at.parent) if (at === fn) return true; return false; };
      const own = writes.filter(write => inside(write.node) && !exempt(write.node));
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
  return { findings, helpers: exportedHelpers, sinks: exportedSinks, constants: exportedConstants, values: exportedValues, reexports, stars };
}

/**
 * Whether a node of a per-call surface file (SurfaceTransactions) sits in a record transaction: inside a function
 * passed to a wrapper (or a wrapper call's argument), inside a local function every reference to which is in one
 * (to a fixpoint), or inside the body of a primitive.
 */
function transactionContexts(sf: ts.SourceFile, transactions: SurfaceTransactions, symbolOf: (node: ts.Node) => ts.Symbol | undefined): (node: ts.Node) => boolean {
  const wrapperCall = (node: ts.Node): boolean => {
    if (!ts.isCallExpression(node)) return false;
    const callee = strip(node.expression);
    return (ts.isIdentifier(callee) && transactions.wrappers.includes(callee.text)) || (ts.isPropertyAccessExpression(callee) && transactions.wrappers.includes(callee.name.text));
  };
  /** Local (non-exported) functions by symbol, and the identifiers that reference each. */
  const locals = new Map<ts.Symbol, { readonly fn: ts.Node; readonly refs: ts.Identifier[] }>();
  const named = (fn: ts.Node): ts.Identifier | undefined => ts.isFunctionDeclaration(fn) && fn.name ? fn.name
    : (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && declarationOf(fn) && ts.isIdentifier(declarationOf(fn)!.name) ? declarationOf(fn)!.name as ts.Identifier : undefined;
  const exported = (fn: ts.Node): boolean => {
    const holder = ts.isFunctionDeclaration(fn) ? fn : declarationOf(fn)?.parent?.parent;
    return holder !== undefined && ts.canHaveModifiers(holder) && (ts.getModifiers(holder)?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false);
  };
  const primitive = (fn: ts.Node): boolean => { const name = named(fn); return name !== undefined && transactions.primitives.includes(name.text); };
  const collect = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      const name = named(node);
      const symbol = name && symbolOf(name);
      if (symbol && !exported(node)) locals.set(symbol, { fn: node, refs: [] });
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);
  const refer = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && named(node.parent) !== node && !(ts.isVariableDeclaration(node.parent) && node.parent.name === node)) {
      const symbol = symbolOf(node);
      const local = symbol && locals.get(symbol);
      if (local) local.refs.push(node);
    }
    ts.forEachChild(node, refer);
  };
  refer(sf);
  const inTx = new Set<ts.Node>();
  const inside = (node: ts.Node): boolean => {
    for (let at: ts.Node | undefined = node; at; at = at.parent) {
      if (at.parent && wrapperCall(at.parent) && (at.parent as ts.CallExpression).arguments.includes(at as ts.Expression)) return true;
      if (inTx.has(at) || ((ts.isFunctionDeclaration(at) || ts.isArrowFunction(at) || ts.isFunctionExpression(at)) && primitive(at))) return true;
    }
    return false;
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const { fn, refs } of locals.values()) if (!inTx.has(fn) && refs.length && refs.every(inside)) { inTx.add(fn); changed = true; }
  }
  return inside;
}

/** Every side-door finding under a repository root (`files` defaults to SIDE_DOOR_SCOPE). */
export function sideDoorFindings(root: string, files = sideDoorFiles(root)): SideDoorFinding[] {
  const options: ts.CompilerOptions = { allowJs: true, noLib: true, noResolve: true, noEmit: true, types: [], jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.Latest };
  const absolute = files.map(file => join(root, file));
  const program = ts.createProgram({ rootNames: absolute, options, host: ts.createCompilerHost(options) });
  const checker = program.getTypeChecker();
  const helpers = new Set<string>(HELPERS);
  const sinks = new Map<string, Set<number>>();
  const constants = new Set<string>();
  const values = new Map<string, string>();
  const reexports = new Map<string, string>();
  const stars = new Map<string, string[]>();
  /** A binding through its re-exports (`export {...} from`, then `export * from`), to the module that declares it. */
  const resolveKey = (key: string, seen = new Set<string>()): string => {
    if (seen.has(key)) return key;
    seen.add(key);
    const named = reexports.get(key);
    if (named !== undefined) return resolveKey(named, seen);
    if (constants.has(key) || values.has(key)) return key;
    const at = key.indexOf("#");
    for (const stem of stars.get(key.slice(0, at)) ?? []) {
      const through = resolveKey(`${stem}${key.slice(at)}`, seen);
      if (constants.has(through) || values.has(through)) return through;
    }
    return key;
  };
  const vocabulary: Vocabulary = { helpers, sinks, constants, values, resolve: key => resolveKey(key) };
  const size = () => helpers.size + [...sinks.values()].reduce((sum, set) => sum + set.size, 0) + constants.size + values.size + reexports.size + [...stars.values()].reduce((sum, list) => sum + list.length, 0);
  // Exported helpers, write wrappers, constants and their re-exports are vocabulary in every file; iterate until no new one appears.
  for (;;) {
    const before = size();
    const out: SideDoorFinding[] = [];
    for (const [index, file] of files.entries()) {
      const sf = program.getSourceFile(absolute[index]!);
      if (!sf) throw new Error(`cannot parse ${file}`);
      const facts = analyse(file, sf, checker, vocabulary);
      for (const name of facts.helpers) helpers.add(name);
      for (const [name, at] of facts.sinks) sinks.set(name, new Set([...(sinks.get(name) ?? []), ...at]));
      for (const key of facts.constants) constants.add(key);
      for (const [key, text] of facts.values) values.set(key, text);
      for (const [key, target] of facts.reexports) reexports.set(key, target);
      if (facts.stars.length) stars.set(stemOf(file), [...new Set([...(stars.get(stemOf(file)) ?? []), ...facts.stars])]);
      out.push(...facts.findings);
    }
    if (size() === before) {
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
