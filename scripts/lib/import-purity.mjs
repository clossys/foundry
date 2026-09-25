/**
 * Import purity: two checks on a set of modules, made by reading their
 * syntax trees with the TypeScript compiler API, never by searching text.
 * It enforces exactly these, and no more:
 *
 * (a) THE IMPORT GRAPH. Every module reachable from the entries imports only
 *     allowlisted builtins and packages. This is sound for static imports:
 *     every static import is found and followed, and a dynamic `import()` is
 *     refused outright, so no module is reached by a path the check did not
 *     see.
 * (b) A LISTED SET OF DIRECT GLOBAL REFERENCES, refused by syntax: the names
 *     and forms listed below, written directly. This is NOT a proof that the
 *     code never reaches a global. JavaScript can reach one indirectly --
 *     `(Date).now()`, `const D = Date; D.now()`, `new (Date)()`,
 *     `Reflect.construct(Date, [])`, `new Intl.DateTimeFormat().format()`,
 *     `[].constructor.constructor("return fetch")()`, or a computed member
 *     name on an allowed builtin -- and (b) does not see those forms. The
 *     tests record them as known limits.
 *
 * So a clean result means: nothing outside the allowlist is imported, and
 * none of the listed globals is written directly. Any stronger claim about a
 * module (that it has no clock, no randomness, no network) rests on (a) plus
 * review of the code, not on this check alone.
 *
 * `checkImportPurity({ entries, allowedBuiltins })` walks every module it
 * reaches:
 *
 * - Static imports, side-effect imports (`import "x"`), re-exports
 *   (`export ... from "x"`) and `import x = require("x")`. A relative
 *   specifier is resolved to a file and followed, transitively; a type-only
 *   import or re-export is erased at build time, so it is not followed.
 * - Every Node.js builtin reached, bare (`fs`) or prefixed (`node:fs`), must
 *   be on the caller's allowlist, which may name it either way. Any other
 *   bare specifier (a package) is refused unless the caller allows it.
 * - Check (b), by syntax tree, so a string or comment that looks like code
 *   changes nothing: it refuses dynamic `import()`, `require`,
 *   `fetch`, `process`, `globalThis`, `global`, `window`, `self`,
 *   `performance`, `eval`, `Function`, `XMLHttpRequest`, `WebSocket`, the
 *   timers (`setTimeout`, `setInterval`, `setImmediate`, `queueMicrotask`),
 *   `import.meta`, `Date.now`, `Date()`, `new Date()` with no argument,
 *   `Math.random`, and the random sources `randomUUID`, `getRandomValues`,
 *   `randomBytes`, `randomInt`, `randomFill` and `randomFillSync`, wherever
 *   the name is used as a reference (a property name such as `a.fetch` or a
 *   key such as `{ fetch: 1 }` is not a reference; a local declared with one
 *   of these names is refused too, because it shadows the global).
 *
 * It returns findings with the file, relative to `root`, and the 1-based
 * line, and the list of files it visited. It never runs the code it reads.
 * It is generic on purpose: any package's pure core can adopt it with its
 * own entries and allowlist.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, extname, relative, resolve } from "node:path";
import ts from "typescript";

const BUILTINS = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));

/** Names refused wherever they are used as a reference, or read as a member by a literal key (`x["fetch"]`). */
export const FORBIDDEN_NAMES = Object.freeze([
  "fetch", "process", "globalThis", "global", "window", "self", "performance", "require", "eval", "Function",
  "XMLHttpRequest", "WebSocket", "setTimeout", "setInterval", "setImmediate", "queueMicrotask",
]);
/** Random sources, refused as a reference and as a member of anything (`crypto.randomUUID`). */
export const RANDOM_NAMES = Object.freeze(["randomUUID", "getRandomValues", "randomBytes", "randomInt", "randomFill", "randomFillSync"]);
const FORBIDDEN = new Set(FORBIDDEN_NAMES);
const RANDOM = new Set(RANDOM_NAMES);

/** The clock or randomness finding for `owner.member`, if it is one. */
function memberFinding(owner, member) {
  if (RANDOM.has(member)) return ["randomness", `uses ${member}`];
  if (owner === "Date" && member === "now") return ["clock", "reads Date.now"];
  if (owner === "Math" && member === "random") return ["randomness", "calls Math.random"];
  return null;
}

/** `node:fs` and `fs` both name the builtin `fs`; `fs/promises` is its own builtin. */
function builtinName(specifier) {
  const bare = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
  if (specifier.startsWith("node:") || BUILTINS.has(bare)) return bare;
  return null;
}

const SOURCE_EXTENSIONS = [".ts", ".mts", ".cts", ".tsx", ".js", ".mjs", ".cjs"];

/** The file a relative specifier names, trying the TypeScript source for a `.js` specifier first. */
function resolveRelative(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [];
  const extension = extname(base);
  if ([".js", ".mjs", ".cjs"].includes(extension)) {
    const stem = base.slice(0, -extension.length);
    candidates.push(`${stem}${extension.replace("js", "ts")}`, `${stem}.tsx`);
  }
  candidates.push(base, ...SOURCE_EXTENSIONS.map((ext) => `${base}${ext}`), ...SOURCE_EXTENSIONS.map((ext) => resolve(base, `index${ext}`)));
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

function scriptKind(file) {
  const extension = extname(file);
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if ([".js", ".mjs", ".cjs"].includes(extension)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** True when `node` is a name used as a value or declaration, not a property name, key, or type-level member name. */
function isReference(node) {
  const parent = node.parent;
  if (!parent) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isQualifiedName(parent) && parent.right === node) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent)
    || ts.isMethodSignature(parent) || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) || ts.isEnumMember(parent)
    ) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return false;
  return true;
}

/**
 * @param {{ entries: string[], allowedBuiltins?: string[], allowedPackages?: string[], root?: string }} options
 * @returns {{ findings: { file: string, line: number, rule: string, message: string }[], visited: string[] }}
 */
export function checkImportPurity({ entries, allowedBuiltins = [], allowedPackages = [], root = process.cwd() }) {
  const allowed = new Set(allowedBuiltins.map((name) => name.replace(/^node:/, "")));
  const packages = new Set(allowedPackages);
  const findings = [];
  const visited = new Set();
  const queue = entries.map((entry) => resolve(root, entry));

  const report = (file, source, node, rule, message) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    findings.push({ file: relative(root, file), line: line + 1, rule, message });
  };

  while (queue.length > 0) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    if (!existsSync(file)) {
      findings.push({ file: relative(root, file), line: 0, rule: "missing-entry", message: "the file does not exist" });
      continue;
    }
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, scriptKind(file));

    const follow = (node, specifier, typeOnly) => {
      const builtin = builtinName(specifier);
      if (builtin !== null) {
        if (!allowed.has(builtin)) report(file, source, node, "builtin-not-allowed", `imports the builtin ${JSON.stringify(specifier)}, which is not on the allowlist`);
        return;
      }
      if (specifier.startsWith(".") || specifier.startsWith("/")) {
        if (typeOnly) return;
        const target = resolveRelative(file, specifier);
        if (target === null) report(file, source, node, "unresolved-import", `imports ${JSON.stringify(specifier)}, which resolves to no file`);
        else queue.push(target);
        return;
      }
      if (typeOnly) return;
      if (!packages.has(specifier)) report(file, source, node, "package-not-allowed", `imports the package ${JSON.stringify(specifier)}, which is not on the allowlist`);
    };

    const visit = (node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        follow(node, node.moduleSpecifier.text, node.importClause?.isTypeOnly === true);
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        follow(node, node.moduleSpecifier.text, node.isTypeOnly);
      } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        const expression = node.moduleReference.expression;
        if (ts.isStringLiteral(expression)) follow(node, expression.text, node.isTypeOnly);
        else report(file, source, node, "dynamic-import", "imports a module whose name is computed");
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        report(file, source, node, "dynamic-import", "uses a dynamic import()");
      } else if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
        report(file, source, node, "forbidden-global", "reads import.meta");
      } else if (ts.isIdentifier(node) && FORBIDDEN.has(node.text) && isReference(node)) {
        report(file, source, node, "forbidden-global", `uses ${node.text}`);
      } else if (ts.isIdentifier(node) && RANDOM.has(node.text) && isReference(node)) {
        report(file, source, node, "randomness", `uses ${node.text}`);
      } else if (ts.isPropertyAccessExpression(node)) {
        const finding = memberFinding(ts.isIdentifier(node.expression) ? node.expression.text : null, node.name.text);
        if (finding) report(file, source, node, ...finding);
      } else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
        const member = node.argumentExpression.text;
        const finding = FORBIDDEN.has(member) ? ["forbidden-global", `reads the member ${member}`] : memberFinding(ts.isIdentifier(node.expression) ? node.expression.text : null, member);
        if (finding) report(file, source, node, ...finding);
      } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Date") {
        report(file, source, node, "clock", "calls Date() for the current time");
      } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Date" && (node.arguments === undefined || node.arguments.length === 0)) {
        report(file, source, node, "clock", "constructs new Date() for the current time");
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  findings.sort((left, right) => (left.file === right.file ? left.line - right.line : left.file < right.file ? -1 : 1));
  return { findings, visited: [...visited].map((file) => relative(root, file)).sort() };
}
