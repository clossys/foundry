/**
 * `scanApprovalBypass` and `checkApprovalBypass` — the APPROVAL-BYPASS gate:
 * does consumer code route copy through the registry's approval lifecycle,
 * or around it? Two patterns defeat that lifecycle while every other gate in
 * this package stays green:
 *
 * 1. `approval-set-in-code` — the code itself declares approval: an object
 *    property or member assignment named `approvedBy` or
 *    `pendingOwnerReview`, or `status` set to the literal `"approved"`
 *    (`{ ...entry, status: "approved" }`, `entry.status = "approved"`). An
 *    approval typed into a component is an approval no owner ever gave.
 * 2. `copy-read-without-resolver` — the code imports the registry file and
 *    reads its content directly (`registry.entries.map(...)`, a spread, any
 *    use other than the first argument of `createCopyResolver`,
 *    `resolveCopyRef`, or `validateCopyRegistryShape`, or of
 *    `parseCopyRegistry` only when its return value is passed to
 *    `createCopyResolver` or `resolveCopyRef`).
 *    A raw map built from the registry skips every lifecycle, staleness and
 *    delegate check the resolver performs.
 *
 * ONLY REGISTRY-COUPLED FILES ARE EXAMINED — a file that imports from
 * `@clossys/writer` (any subpath) or imports the registry file. That keeps a
 * domain model with its own unrelated `status: "approved"` out of scope. It
 * is a STATED LIMIT, not an oversight: a file that copies registry data
 * without importing either (pasted JSON, data fetched at runtime, a registry
 * passed in from an uncoupled module) is never seen by this gate.
 *
 * NO PARSER LIBRARY and no second tokenizer: every comment, string, template,
 * regex and JSX-text boundary comes from `scan.ts`'s `maskNonCode`. The
 * patterns here are matched against its masked `code` (so a comment or a
 * string can never match), and literal values are looked up through its
 * `literals` list. The heuristics that remain are narrow and local; each
 * known gap is listed beside the function that has it.
 *
 * ============================================================================
 * THE TERNARY
 * ============================================================================
 *
 * The same precedence `addressability.ts` uses (issue #407): a definite
 * finding outranks an incomplete picture.
 *
 *   - `"violated"` — at least one finding, regardless of unchecked positions.
 *     `reasons` still lists any coverage gap.
 *   - `"indeterminate"` — no finding, but an unchecked position (a dynamic or
 *     otherwise unresolvable registry load, a string naming the registry), a
 *     parse failure, or zero files scanned. Never a pass.
 *   - `"satisfied"` — at least one file scanned, nothing unchecked, no
 *     finding. Zero coupled files among ≥1 scanned file is satisfied.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { maskNonCode, type MaskedLiteral } from "./scan.js";
import type { ParseFailure, SkippedFile } from "./scan.js";

export type { ParseFailure, SkippedFile } from "./scan.js";

// ------------------------------------------------------------------ types

export interface ApprovalBypassScanOptions {
  /** The copy registry file. Absolute, or relative to the scan `root`. Must exist. */
  registryPath: string;
  /** File extensions to read, each including the leading dot. Default: `.ts`, `.tsx`, `.js`, `.jsx`. */
  extensions?: string[];
  /** Directory names never descended into. Default: node_modules, .git, dist, build, coverage. */
  skipDirs?: string[];
}

export type ApprovalBypassRule = "approval-set-in-code" | "copy-read-without-resolver";

export interface ApprovalBypassFinding {
  rule: ApprovalBypassRule;
  severity: "error";
  file: string;
  line: number;
  detail: string;
}

export interface ApprovalBypassUncheckedItem {
  file: string;
  line: number;
  /** `"registry-dynamic-import"`, `"dynamic-import-non-literal"`, `"registry-require-unbound"`, `"require-non-literal"`, `"registry-reexport"` or `"registry-path-string"`. */
  kind: string;
  detail: string;
}

export interface ApprovalBypassScanResult {
  /** Files successfully tokenized, coupled or not. Required to be > 0 for a satisfied verdict. */
  filesScanned: number;
  /** Root-relative paths of the files that were examined. */
  coupledFiles: string[];
  findings: ApprovalBypassFinding[];
  unchecked: ApprovalBypassUncheckedItem[];
  skippedByDesign: SkippedFile[];
  parseFailures: ParseFailure[];
}

export type ApprovalBypassVerdict = "violated" | "indeterminate" | "satisfied";

export interface ApprovalBypassGateResult {
  verdict: ApprovalBypassVerdict;
  findings: ApprovalBypassFinding[];
  unchecked: ApprovalBypassUncheckedItem[];
  /** Why coverage is incomplete. Empty for `"satisfied"`; may be non-empty for `"violated"`. */
  reasons: string[];
}

export interface ApprovalBypassExtractResult {
  coupled: boolean;
  findings: ApprovalBypassFinding[];
  unchecked: ApprovalBypassUncheckedItem[];
  parseFailure?: string;
}

// --------------------------------------------------------------- walking

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const DEFAULT_SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage"]);
/** The same test/spec/check and `.d.ts` pattern `scan.ts` and `addressability.ts` use. */
const SKIP_FILE_RE = /\.(test|spec|check)\.(ts|tsx|js|jsx)$|\.d\.ts$/;

function realOrResolved(path: string): string {
  const resolved = resolve(path);
  if (!existsSync(resolved)) return resolved;
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/**
 * Walks `root`, examining every registry-coupled source file (see
 * `extractApprovalBypass`). FAILS CLOSED — throws a plain `Error` — on an
 * unreadable directory or file and on a missing registry file: either one
 * means the scan cannot say what it did not see.
 */
export function scanApprovalBypass(root: string, options: ApprovalBypassScanOptions): ApprovalBypassScanResult {
  const extensions = new Set((options.extensions ?? DEFAULT_EXTENSIONS).map((e) => e.toLowerCase()));
  const skipDirs = new Set(options.skipDirs ?? DEFAULT_SKIP_DIRS);
  const registryAbs = isAbsolute(options.registryPath) ? resolve(options.registryPath) : resolve(root, options.registryPath);
  if (!existsSync(registryAbs)) {
    throw new Error(`scanApprovalBypass: registry file "${options.registryPath}" does not exist (resolved "${registryAbs}")`);
  }
  const registryReal = realOrResolved(registryAbs);

  const result: ApprovalBypassScanResult = {
    filesScanned: 0,
    coupledFiles: [],
    findings: [],
    unchecked: [],
    skippedByDesign: [],
    parseFailures: [],
  };

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (error) {
      throw new Error(`scanApprovalBypass: cannot read directory "${dir}": ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const entry of entries) {
      if (skipDirs.has(entry)) continue;
      const full = join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue; // broken symlink — nothing to read, not a directory-listing failure
      }
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (!stat.isFile()) continue;
      if (!extensions.has(extname(entry).toLowerCase())) continue;
      if (realOrResolved(full) === registryReal) continue; // the registry itself is data, not consumer code

      const relPath = relative(root, full).split(sep).join("/");
      if (SKIP_FILE_RE.test(entry)) {
        result.skippedByDesign.push({ file: relPath, reason: "test-or-check-file" });
        continue;
      }

      let content: string;
      try {
        content = readFileSync(full, "utf8");
      } catch (error) {
        throw new Error(`scanApprovalBypass: cannot read file "${full}": ${error instanceof Error ? error.message : String(error)}`);
      }

      const extracted = extractApprovalBypass(content, relPath, { registryPath: registryAbs, absoluteFilePath: full });
      if (extracted.parseFailure !== undefined) {
        result.parseFailures.push({ file: relPath, detail: extracted.parseFailure });
        continue;
      }
      result.filesScanned++;
      if (!extracted.coupled) continue;
      result.coupledFiles.push(relPath);
      result.findings.push(...extracted.findings);
      result.unchecked.push(...extracted.unchecked);
    }
  }

  walk(root);
  return result;
}

// ------------------------------------------------------- code-text helpers

const IDENT = "[A-Za-z_$][\\w$]*";
const ID_CONTINUE_IN_CLASS = "\\p{ID_Continue}$";
/** Character before an allowed callee must not continue an identifier, `$`, or `.`. */
const CALLEE_BOUNDARY = `(?<![${ID_CONTINUE_IN_CLASS}.])`;
const NOT_ID_CONTINUE = `(?![${ID_CONTINUE_IN_CLASS}])`;
const WRITER_PACKAGE_CALLEES = ["createCopyResolver", "resolveCopyRef", "parseCopyRegistry", "validateCopyRegistryShape"] as const;
const WRITER_PACKAGE_CALLEE_SET = new Set<string>(WRITER_PACKAGE_CALLEES);
const APPROVAL_KEYS = new Set(["approvedBy", "pendingOwnerReview"]);
/** A plain or compound assignment operator, never a comparison or an arrow. */
const ASSIGN_OP_RE = /^\s*(?:\?\?|\|\||&&)?=(?![=>])/;

function isWs(c: string | undefined): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v";
}

/** Escapes every regular-expression metacharacter in `value`, backslash included. */
function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function prevNonWs(code: string, idx: number): number {
  let i = idx - 1;
  while (i >= 0 && isWs(code[i])) i--;
  return i;
}

function nextNonWs(code: string, idx: number): number {
  let i = idx;
  while (i < code.length && isWs(code[i])) i++;
  return i;
}

/** Index of the nearest unclosed `{`, `(` or `[` before `idx`, or -1. `code` is masked, so every bracket seen is real code. */
function enclosingOpener(code: string, idx: number): number {
  let depth = 0;
  for (let i = idx - 1; i >= 0; i--) {
    const c = code[i];
    if (c === "}" || c === ")" || c === "]") depth++;
    else if (c === "{" || c === "(" || c === "[") {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

let matchingCloseTableCode: string | undefined;
let matchingCloseTable: Int32Array | undefined;

function buildMatchingCloseTable(code: string): Int32Array {
  const closeAt = new Int32Array(code.length);
  closeAt.fill(-1);
  const stack: number[] = [];
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === "{" || c === "(" || c === "[") stack.push(i);
    else if (c === "}" || c === ")" || c === "]") {
      if (stack.length === 0) continue;
      const open = stack.pop()!;
      closeAt[open] = i;
    }
  }
  return closeAt;
}

function matchingClose(code: string, open: number): number {
  if (matchingCloseTableCode !== code) {
    matchingCloseTableCode = code;
    matchingCloseTable = buildMatchingCloseTable(code);
  }
  const c = code[open];
  if (c !== "{" && c !== "(" && c !== "[") return -1;
  return matchingCloseTable![open] ?? -1;
}

const ID_CONTINUE_RE = /[\p{ID_Continue}$]/u;
const ID_START_RE = /[\p{ID_Start}$_]/u;

function isHighSurrogateUnit(c: string): boolean {
  const u = c.charCodeAt(0);
  return u >= 0xd800 && u <= 0xdbff;
}

function isLowSurrogateUnit(c: string): boolean {
  const u = c.charCodeAt(0);
  return u >= 0xdc00 && u <= 0xdfff;
}

/** Index of the first UTF-16 code unit of the code point ending at `end`. */
function codePointStartAt(code: string, end: number): number {
  if (end > 0 && isLowSurrogateUnit(code[end]!) && isHighSurrogateUnit(code[end - 1]!)) return end - 1;
  return end;
}

/** Index of the last UTF-16 code unit of the code point starting at `start`. */
function codePointEndAt(code: string, start: number): number {
  if (isHighSurrogateUnit(code[start]!) && start + 1 < code.length && isLowSurrogateUnit(code[start + 1]!)) return start + 1;
  return start;
}

function codePointBefore(code: string, start: number): string | undefined {
  if (start <= 0) return undefined;
  const prevEnd = start - 1;
  const prevStart = codePointStartAt(code, prevEnd);
  return code.slice(prevStart, codePointEndAt(code, prevStart) + 1);
}

function codePointAt(code: string, start: number): string {
  const end = codePointEndAt(code, start);
  return code.slice(start, end + 1);
}

function isIdContinueCodePoint(cp: string): boolean {
  return ID_CONTINUE_RE.test(cp);
}

function isIdStartCodePoint(cp: string): boolean {
  return ID_START_RE.test(cp);
}

/** Reads the identifier immediately before `(` at `innerOpen`, or `undefined` when it is not a plain callee name. */
function calleeBeforeOpenParen(code: string, innerOpen: number): string | undefined {
  let i = innerOpen - 1;
  while (i >= 0 && isWs(code[i])) i--;
  if (i < 0) return undefined;
  const identEnd = i;
  let end = i;
  while (end >= 0) {
    const cpStart = codePointStartAt(code, end);
    if (!isIdContinueCodePoint(codePointAt(code, cpStart))) break;
    end = cpStart - 1;
  }
  const start = end + 1;
  const ident = code.slice(start, identEnd + 1);
  if (ident.length === 0 || !isIdStartCodePoint(codePointAt(code, start))) return undefined;
  const before = codePointBefore(code, start);
  if (before !== undefined) {
    if (before === "." || before === "$" || isIdContinueCodePoint(before)) return undefined;
  }
  return ident;
}

/** Innermost `(` call whose argument list contains `idx`. `code` is masked. */
function callContaining(code: string, idx: number): { open: number; close: number; callee: string } | undefined {
  let depth = 0;
  let innerOpen = -1;
  for (let k = idx; k >= 0; k--) {
    const c = code[k];
    if (c === ")") depth++;
    else if (c === "(") {
      if (depth === 0) {
        innerOpen = k;
        break;
      }
      depth--;
    }
  }
  if (innerOpen === -1) return undefined;
  const close = matchingClose(code, innerOpen);
  if (close === -1 || idx > close) return undefined;
  const callee = calleeBeforeOpenParen(code, innerOpen);
  if (!callee) return undefined;
  return { open: innerOpen, close, callee };
}

function isResolverExport(exportName: string): boolean {
  return exportName === "createCopyResolver" || exportName === "resolveCopyRef";
}

interface WriterCalleeImports {
  localNames: Set<string>;
  localToExport: Map<string, string>;
}

/**
 * When a registry import binding is the argument to `parseCopyRegistry`, the
 * parse result must reach `createCopyResolver`/`resolveCopyRef` — not be
 * read inline (`parseCopyRegistry(registry).entries`) or passed elsewhere.
 */
function writerCalleeAllowed(
  callee: string,
  writerImports: WriterCalleeImports,
  localShadowedCalleepNames: Set<string>,
): boolean {
  return writerImports.localNames.has(callee) && !localShadowedCalleepNames.has(callee);
}

function declaratorListInitEndsAtCall(code: string, declKeywordEnd: number, call: { open: number; close: number }): boolean {
  let i = skipWsCode(code, declKeywordEnd);
  for (;;) {
    const identStart = i;
    i = skipIdentCode(code, i);
    if (i === identStart) return false;
    i = skipWsCode(code, i);
    if (code[i] === ":") {
      i = skipTypeAnnotation(code, i + 1);
      i = skipWsCode(code, i);
    }
    if (code[i] === "=") {
      i = skipWsCode(code, i + 1);
      const initStart = i;
      i = skipIdentCode(code, i);
      i = skipWsCode(code, i);
      if (initStart <= call.open && i === skipWsCode(code, call.open)) return true;
      i = skipExpressionUntilCommaOrSemicolon(code, initStart);
    }
    i = skipWsCode(code, i);
    if (code[i] === ",") {
      i = skipWsCode(code, i + 1);
      continue;
    }
    return false;
  }
}

/** Skips one top-level declarator initializer (through nested calls and brackets). */
function skipExpressionUntilCommaOrSemicolon(code: string, i: number): number {
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  while (i < code.length) {
    const c = code[i]!;
    if (depthParen === 0 && depthBrace === 0 && depthBracket === 0 && (c === "," || c === ";")) break;
    if (c === "(") depthParen++;
    else if (c === ")") depthParen = Math.max(0, depthParen - 1);
    else if (c === "{") depthBrace++;
    else if (c === "}") depthBrace = Math.max(0, depthBrace - 1);
    else if (c === "[") depthBracket++;
    else if (c === "]") depthBracket = Math.max(0, depthBracket - 1);
    i++;
  }
  return i;
}

function parseCopyRegistryBindingInitEndsAtCall(code: string, call: { open: number; close: number }): boolean {
  const prefix = code.slice(0, call.open);
  const matches = [...prefix.matchAll(new RegExp(`${CALLEE_BOUNDARY}(?:const|let|var)\\s+`, "gu"))];
  for (let d = matches.length - 1; d >= 0; d--) {
    const decl = matches[d]!;
    const kwEnd = decl.index! + decl[0].length;
    if (declaratorListInitEndsAtCall(code, kwEnd, call)) return true;
  }
  return false;
}

/** Comma in `const a = x, b = y` starts the next declarator — not a continued expression. */
function commaStartsNextDeclarator(code: string, commaIdx: number): boolean {
  let j = skipWsCode(code, commaIdx + 1);
  const identStart = j;
  j = skipIdentCode(code, j);
  if (j === identStart) return false;
  j = skipWsCode(code, j);
  if (code[j] === ":") {
    j = skipTypeAnnotation(code, j + 1);
    j = skipWsCode(code, j);
  }
  return code[j] === "=";
}

/** A line break before `+`, `(`, `.`, `?.`, etc. continues the initializer — not a finished binding. */
function postfixContinuesParseResult(code: string, idx: number): boolean {
  const c = code[idx];
  if (c === "," && commaStartsNextDeclarator(code, idx)) return false;
  if (c === "+" || c === "-" || c === "*" || c === "/" || c === "%" || c === "(" || c === ",") return true;
  if (c === "." && code[idx + 1] !== ".") return true;
  if (code.slice(idx, idx + 2) === "?.") return true;
  if (code.slice(idx, idx + 2) === "??") return true;
  if (code.slice(idx, idx + 2) === "||") return true;
  if (code.slice(idx, idx + 2) === "&&") return true;
  if (code.slice(idx, idx + 3) === "===") return true;
  if (code.slice(idx, idx + 3) === "!==") return true;
  if (code.slice(idx, idx + 2) === "!=" && code[idx + 2] !== "=") return true;
  if (code.slice(idx, idx + 2) === "==" && code[idx + 2] !== "=") return true;
  if (code.slice(idx, idx + 2) === "<=" || code.slice(idx, idx + 2) === ">=") return true;
  if (c === "<" && !ltAtIsGenericOpener(code, idx)) return true;
  if (c === ">" && (idx === 0 || code[idx - 1] !== "=") && !ltAtIsGenericOpener(code, idx)) return true;
  return false;
}

function parseCopyRegistryRegistryArgAllowed(
  code: string,
  argIdx: number,
  writerImports: WriterCalleeImports,
  localShadowedCalleepNames: Set<string>,
): boolean {
  const call = callContaining(code, argIdx);
  if (!call) return false;
  const parseExport = writerImports.localToExport.get(call.callee);
  if (parseExport !== "parseCopyRegistry") return false;
  if (!writerCalleeAllowed(call.callee, writerImports, localShadowedCalleepNames)) return false;
  const afterClose = nextNonWs(code, call.close + 1);
  const next = code[afterClose];
  if (next === "." || next === "[") return false;
  if (next === "," && commaStartsNextDeclarator(code, afterClose)) return true;
  if (next === "," || next === ")") {
    const outer = callContaining(code, call.close);
    if (!outer) return false;
    const outerExport = writerImports.localToExport.get(outer.callee);
    return outerExport !== undefined && isResolverExport(outerExport) && writerCalleeAllowed(outer.callee, writerImports, localShadowedCalleepNames);
  }
  if (postfixContinuesParseResult(code, afterClose)) return false;
  const gap = code.slice(call.close + 1, afterClose);
  const gapHasNewline = /[\r\n]/.test(gap);
  if (next === ";" || next === undefined || gapHasNewline) {
    return parseCopyRegistryBindingInitEndsAtCall(code, call);
  }
  return false;
}

function bindingNameAtCallArgument(code: string, bindIdx: number, bindNameLen: number): boolean {
  let i = bindIdx + bindNameLen;
  while (i < code.length && isWs(code[i])) i++;
  const c = code[i];
  return c === "," || c === ")";
}

function registryBindingUseAllowed(
  code: string,
  bindIdx: number,
  bindNameLen: number,
  fromParsedRegistry: boolean,
  parseRegistryAssign: boolean,
  writerImports: WriterCalleeImports,
  localShadowedCalleepNames: Set<string>,
): boolean {
  if (!bindingNameAtCallArgument(code, bindIdx, bindNameLen)) return false;
  const call = callContaining(code, bindIdx);
  if (!call) return false;
  if (!writerCalleeAllowed(call.callee, writerImports, localShadowedCalleepNames)) return false;
  const exportName = writerImports.localToExport.get(call.callee);
  if (exportName === undefined) return false;
  if (parseRegistryAssign && !fromParsedRegistry) return false;
  if (fromParsedRegistry) return isResolverExport(exportName);
  if (exportName === "parseCopyRegistry") {
    return parseCopyRegistryRegistryArgAllowed(code, bindIdx, writerImports, localShadowedCalleepNames);
  }
  return isResolverExport(exportName) || exportName === "validateCopyRegistryShape";
}

function collectWriterCalleeImports(specifiers: Specifier[], isWriter: (s: string) => boolean, code: string): WriterCalleeImports {
  const localNames = new Set<string>();
  const localToExport = new Map<string, string>();
  const note = (local: string, imported: string): void => {
    localNames.add(local);
    localToExport.set(local, imported);
  };
  for (const spec of specifiers) {
    if (!isWriter(spec.lit.text)) continue;
    if (spec.form === "static") {
      const clause = code.slice(spec.stmtStart + "import".length, spec.lit.start).replace(/\bfrom\s*$/, "").trim();
      if (/^type\s+(?!,)/.test(clause) && clause !== "type") continue;
      const named = /\{([^}]*)\}/.exec(clause);
      if (named) {
        for (const part of named[1]!.split(",")) {
          const m = new RegExp(`^\\s*(type\\s+)?(${IDENT})?\\s*(?:as\\s+(${IDENT}))?\\s*$`, "u").exec(part);
          if (!m || m[1]) continue;
          const imported = m[2];
          const local = m[3] ?? imported;
          if (local === undefined || imported === undefined) continue;
          if (WRITER_PACKAGE_CALLEE_SET.has(imported)) note(local, imported);
        }
      }
    } else if (spec.form === "import-equals") {
      const m = new RegExp(`import\\s+(?:type\\s+)?(${IDENT})\\s*=`, "u").exec(code.slice(spec.stmtStart, spec.lit.start));
      if (m && WRITER_PACKAGE_CALLEE_SET.has(m[1]!)) note(m[1]!, m[1]!);
    } else if (spec.form === "require") {
      const pre = code.slice(Math.max(0, spec.stmtStart - 400), spec.stmtStart);
      const decl = new RegExp(`${CALLEE_BOUNDARY}(?:const|let|var)\\s+\\{([^}]*)\\}\\s*=\\s*$`, "u").exec(pre);
      if (decl) {
        for (const part of decl[1]!.split(",")) {
          const trimmed = part.trim();
          if (!trimmed) continue;
          const m = new RegExp(`^(?:(${IDENT})|(${IDENT})\\s*:\\s*(${IDENT}))\\s*$`, "u").exec(trimmed);
          if (!m) continue;
          const local = m[1] ?? m[3];
          const imported = m[2] ?? m[1];
          if (local && imported && WRITER_PACKAGE_CALLEE_SET.has(imported)) note(local, imported);
        }
      }
    }
  }
  return { localNames, localToExport };
}

function writerRequireDestructureSpans(specifiers: Specifier[], isWriter: (s: string) => boolean, code: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  for (const spec of specifiers) {
    if (spec.form !== "require" || !isWriter(spec.lit.text)) continue;
    const preStart = Math.max(0, spec.stmtStart - 400);
    const pre = code.slice(preStart, spec.stmtStart);
    const decl = new RegExp(`${CALLEE_BOUNDARY}(?:const|let|var)\\s+\\{([^}]*)\\}\\s*=\\s*$`, "u").exec(pre);
    if (decl) spans.push({ start: preStart + decl.index!, end: spec.stmtStart });
  }
  return spans;
}

function splitDestructuringParts(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= inner.length; i++) {
    const c = inner[i];
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === "," && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts;
}

function destructuringPatternShadowsName(inner: string, name: string): boolean {
  const esc = escapeRegExp(name);
  for (const part of splitDestructuringParts(inner)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (new RegExp(`^${esc}(?:\\s*=.*)?$`, "u").test(trimmed)) return true;
    if (new RegExp(`^${IDENT}\\s*:\\s*${esc}(?:\\s*=.*)?$`, "u").test(trimmed)) return true;
    if (new RegExp(`^\\.\\.\\.\\s*${esc}$`, "u").test(trimmed)) return true;
    if (new RegExp(`^\\[[^\\]]+\\]\\s*:\\s*${esc}(?:\\s*=.*)?$`, "u").test(trimmed)) return true;
    const computedNested = new RegExp(`^\\[[^\\]]+\\]\\s*:\\s*\\{`, "u").exec(trimmed);
    if (computedNested) {
      const open = trimmed.indexOf("{", computedNested.index);
      const close = matchingClose(trimmed, open);
      if (close > open && destructuringPatternShadowsName(trimmed.slice(open + 1, close), name)) return true;
    }
    const nestedObj = new RegExp(`^${IDENT}\\s*:\\s*\\{`, "u").exec(trimmed);
    if (nestedObj) {
      const open = trimmed.indexOf("{", nestedObj.index);
      const close = matchingClose(trimmed, open);
      if (close > open && destructuringPatternShadowsName(trimmed.slice(open + 1, close), name)) return true;
    }
    const nestedArr = new RegExp(`^${IDENT}\\s*:\\s*\\[`, "u").exec(trimmed);
    if (nestedArr) {
      const open = trimmed.indexOf("[", nestedArr.index);
      const close = matchingClose(trimmed, open);
      if (close > open && arrayPatternShadowsName(trimmed.slice(open + 1, close), name)) return true;
    }
  }
  return false;
}

function arrayPatternShadowsName(inner: string, name: string): boolean {
  const esc = escapeRegExp(name);
  for (const part of splitDestructuringParts(inner)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (new RegExp(`^${esc}(?:\\s*=.*)?$`, "u").test(trimmed)) return true;
    if (new RegExp(`^\\.\\.\\.\\s*${esc}(?:\\s*=.*)?$`, "u").test(trimmed)) return true;
    if (trimmed.startsWith("{")) {
      const close = matchingClose(trimmed, 0);
      if (close > 0 && destructuringPatternShadowsName(trimmed.slice(1, close), name)) return true;
    }
    if (trimmed.startsWith("[")) {
      const close = matchingClose(trimmed, 0);
      if (close > 0 && arrayPatternShadowsName(trimmed.slice(1, close), name)) return true;
    }
  }
  return false;
}

/** Statement keywords mistaken for shorthand object methods when `{ if (x)` opens a block. */
const CONTROL_FLOW_BLOCK_KEYWORDS = new Set(["if", "while", "switch"]);

function isDeclareFunctionPrefix(code: string, fnKeywordIndex: number): boolean {
  let i = fnKeywordIndex - 1;
  while (i >= 0 && isWs(code[i])) i--;
  const wordEnd = i;
  while (i >= 0) {
    const cpStart = codePointStartAt(code, i);
    if (!isIdContinueCodePoint(codePointAt(code, cpStart))) break;
    i = cpStart - 1;
  }
  const wordStart = i + 1;
  if (code.slice(wordStart, wordEnd + 1) !== "declare") return false;
  if (wordStart > 0) {
    const before = codePointBefore(code, wordStart);
    if (before !== undefined && (isIdContinueCodePoint(before) || before === "$" || before === ".")) return false;
  }
  return true;
}

function skipWsCode(code: string, i: number): number {
  while (i < code.length && isWs(code[i])) i++;
  return i;
}

function skipIdentCode(code: string, i: number): number {
  if (i >= code.length || !isIdStartCodePoint(codePointAt(code, i))) return i;
  i = codePointEndAt(code, i) + 1;
  while (i < code.length && isIdContinueCodePoint(codePointAt(code, i))) i = codePointEndAt(code, i) + 1;
  return i;
}

function skipPostfixTypeArrayBrackets(code: string, i: number): number {
  for (;;) {
    i = skipWsCode(code, i);
    if (code[i] !== "[") break;
    const end = matchingClose(code, i);
    i = end === -1 ? code.length : end + 1;
  }
  return i;
}

/** A full type annotation after `:` — unions, intersections, and postfix arrays. */
function skipTypeAnnotation(code: string, i: number): number {
  for (;;) {
    i = skipWsCode(code, i);
    i = skipTypeOperand(code, i);
    i = skipWsCode(code, i);
    const c = code[i];
    if (c === "|" || c === "&") {
      i++;
      continue;
    }
    break;
  }
  return i;
}

/** One extends/type operand: a name, generic, object type, or parenthesized type. */
function skipTypeOperand(code: string, i: number): number {
  i = skipWsCode(code, i);
  for (;;) {
    const kwStart = i;
    i = skipIdentCode(code, i);
    if (i === kwStart) break;
    const word = code.slice(kwStart, i);
    if (word === "readonly") continue;
    if (word === "keyof" || word === "typeof" || word === "infer") {
      i = skipWsCode(code, i);
      continue;
    }
    if (word === "unique") {
      i = skipWsCode(code, i);
      i = skipIdentCode(code, i);
      return skipPostfixTypeArrayBrackets(code, i);
    }
    i = kwStart;
    break;
  }
  i = skipWsCode(code, i);
  const c = code[i];
  if (c === "{") {
    const end = matchingClose(code, i);
    i = end === -1 ? code.length : end + 1;
    return skipPostfixTypeArrayBrackets(code, i);
  }
  if (c === "(") {
    const end = matchingClose(code, i);
    i = end === -1 ? code.length : end + 1;
    i = skipWsCode(code, i);
    if (code[i] === "=" && code[i + 1] === ">") {
      i += 2;
      i = skipTypeOperand(code, skipWsCode(code, i));
    }
    return skipPostfixTypeArrayBrackets(code, i);
  }
  if (c === "<") {
    i = indexAfterGenericTypeParamList(code, i);
    return skipPostfixTypeArrayBrackets(code, i);
  }
  if (c === undefined) return i;
  i = skipQualifiedTypeName(code, i);
  return skipPostfixTypeArrayBrackets(code, i);
}

/** Consumes `Foo`, `Foo.Bar`, and `Foo.Bar<Baz>` in type positions. */
function skipQualifiedTypeName(code: string, i: number): number {
  i = skipIdentCode(code, i);
  for (;;) {
    i = skipWsCode(code, i);
    if (code[i] === "<" && ltAtIsGenericOpener(code, i)) {
      i = indexAfterGenericTypeParamList(code, i);
      i = skipWsCode(code, i);
    }
    if (code[i] !== ".") break;
    i++;
    i = skipIdentCode(code, i);
  }
  return i;
}

function isKeywordAt(code: string, i: number, kw: string): boolean {
  if (code.slice(i, i + kw.length) !== kw) return false;
  const next = code[i + kw.length];
  return next === undefined || !/[\w$]/.test(next);
}

/** Index of `{` opening a `declare` / `declare abstract` class body after the `declare` keyword. */
function declareClassBodyBraceAfterDeclareKeyword(code: string, declareIdx: number): number {
  let i = declareIdx + "declare".length;
  i = skipWsCode(code, i);
  if (isKeywordAt(code, i, "abstract")) {
    i += "abstract".length;
    i = skipWsCode(code, i);
  }
  if (!isKeywordAt(code, i, "class")) return -1;
  i += "class".length;
  i = skipWsCode(code, i);
  const nameStart = i;
  i = skipIdentCode(code, i);
  if (i === nameStart) return -1;
  i = skipOptionalGenericTypeParams(code, i);
  i = skipWsCode(code, i);
  if (isExtendsKeywordAt(code, i)) {
    i += 7;
    i = skipWsCode(code, i);
    i = skipTypeOperand(code, i);
  }
  i = skipWsCode(code, i);
  if (isKeywordAt(code, i, "implements")) {
    i += "implements".length;
    for (;;) {
      i = skipWsCode(code, i);
      i = skipTypeOperand(code, i);
      i = skipWsCode(code, i);
      if (code[i] === ",") {
        i++;
        continue;
      }
      break;
    }
  }
  i = skipWsCode(code, i);
  return code[i] === "{" ? i : -1;
}

function eachDeclareClassBodySpan(code: string, visit: (openBrace: number, closeBrace: number) => void): void {
  for (const m of code.matchAll(new RegExp(`${CALLEE_BOUNDARY}(?:export\\s+)?declare\\s+`, "gu"))) {
    const declareIdx = code.indexOf("declare", m.index!);
    if (declareIdx === -1) continue;
    const open = declareClassBodyBraceAfterDeclareKeyword(code, declareIdx);
    if (open === -1) continue;
    const close = matchingClose(code, open);
    if (close === -1) continue;
    visit(open, close);
  }
}

function indexInsideDeclareBlock(code: string, idx: number, kind: "class" | "namespace"): boolean {
  if (kind === "class") {
    let inside = false;
    eachDeclareClassBodySpan(code, (open, close) => {
      if (idx > open && idx < close) inside = true;
    });
    return inside;
  }
  const head = new RegExp(`${CALLEE_BOUNDARY}declare\\s+namespace\\s+${IDENT}\\s*\\{`, "gu");
  for (const m of code.matchAll(head)) {
    const open = m.index! + m[0].length - 1;
    const close = matchingClose(code, open);
    if (close !== -1 && idx > open && idx < close) return true;
  }
  return false;
}

/** Whether `{` at `openBrace` opens the body of a `declare class` (any class-name length). */
function openBraceIsDeclareClassBody(code: string, openBrace: number): boolean {
  if (code[openBrace] !== "{") return false;
  let match = false;
  eachDeclareClassBodySpan(code, (open) => {
    if (open === openBrace) match = true;
  });
  return match;
}

/** `typeof` followed only by whitespace before the registry binding — a type query, not a read. */
function bindingFollowsTypeofQuery(code: string, bindIdx: number): boolean {
  let j = bindIdx - 1;
  while (j >= 0 && isWs(code[j]!)) j--;
  if (j < 5) return false;
  if (code.slice(j - 5, j + 1) !== "typeof") return false;
  const typeofStart = j - 5;
  const before = codePointBefore(code, typeofStart);
  if (before !== undefined && (isIdContinueCodePoint(before) || before === "$" || before === ".")) return false;
  return true;
}

function functionInDeclareNamespace(code: string, fnKeywordIndex: number): boolean {
  return indexInsideDeclareBlock(code, fnKeywordIndex, "namespace");
}

function isDeclareNamespacePrefix(code: string, namespaceKeywordIndex: number): boolean {
  const before = code.slice(Math.max(0, namespaceKeywordIndex - 12), namespaceKeywordIndex);
  return /(?:^|\s)declare\s+$/.test(before);
}

function indexInsidePlainNamespaceBlock(code: string, idx: number): boolean {
  for (const m of code.matchAll(new RegExp(`${CALLEE_BOUNDARY}namespace\\s+${IDENT}\\s*\\{`, "gu"))) {
    const nsIdx = m.index! + m[0].indexOf("namespace");
    if (isDeclareNamespacePrefix(code, nsIdx)) continue;
    const open = m.index! + m[0].length - 1;
    const close = matchingClose(code, open);
    if (close !== -1 && idx > open && idx < close) return true;
  }
  return false;
}

/** Namespace overload/signature declarations (`function f(x: T): R;`) are not value bindings. */
function functionSignatureNotFollowedByBlock(code: string, fnKeywordIndex: number): boolean {
  let i = fnKeywordIndex + "function".length;
  i = skipWsCode(code, i);
  if (code[i] === "*") i++;
  i = skipIdentCode(code, i);
  i = skipWsCode(code, i);
  if (code[i] === "<") {
    i = indexAfterGenericTypeParamList(code, i);
    i = skipWsCode(code, i);
  }
  if (code[i] !== "(") return false;
  const close = matchingClose(code, i);
  if (close === -1) return false;
  i = skipWsCode(code, close + 1);
  i = skipReturnTypeAfterParamList(code, i);
  i = skipWsCode(code, i);
  return code[i] !== "{";
}

function functionInPlainNamespaceWithoutBody(code: string, fnKeywordIndex: number): boolean {
  return (
    indexInsidePlainNamespaceBlock(code, fnKeywordIndex) &&
    functionSignatureNotFollowedByBlock(code, fnKeywordIndex)
  );
}

function skipFunctionParamValueBinding(code: string, fnKeywordIndex: number): boolean {
  if (isDeclareFunctionPrefix(code, fnKeywordIndex)) return true;
  if (functionInDeclareNamespace(code, fnKeywordIndex)) return true;
  if (functionInPlainNamespaceWithoutBody(code, fnKeywordIndex)) return true;
  return false;
}

function constructorInDeclareClass(code: string, constructorIdx: number): boolean {
  return indexInsideDeclareBlock(code, constructorIdx, "class");
}

function isExtendsKeywordAt(code: string, i: number): boolean {
  return isKeywordAt(code, i, "extends");
}

function skipOptionalGenericTypeParams(code: string, i: number): number {
  i = skipWsCode(code, i);
  if (code[i] !== "<" || !ltAtIsGenericOpener(code, i)) return i;
  return skipWsCode(code, indexAfterGenericTypeParamList(code, i));
}

function interfaceBodyBraceIndex(code: string, openBrace: number): boolean {
  for (const m of code.matchAll(new RegExp(`\\binterface\\s+${IDENT}`, "gu"))) {
    let i = m.index! + m[0].length;
    i = skipWsCode(code, i);
    i = skipOptionalGenericTypeParams(code, i);
    i = skipWsCode(code, i);
    if (isExtendsKeywordAt(code, i)) {
      i += 7;
      i = skipWsCode(code, i);
      for (;;) {
        i = skipWsCode(code, i);
        if (code[i] === "{") break;
        i = skipTypeOperand(code, i);
        i = skipWsCode(code, i);
        if (code[i] === ",") {
          i++;
          continue;
        }
        break;
      }
    } else {
      while (i < code.length && code[i] !== "{" && code[i] !== ";") {
        const before = i;
        i = skipIdentCode(code, i);
        i = skipWsCode(code, i);
        if (i === before) break;
      }
    }
    i = skipWsCode(code, i);
    if (i === openBrace && code[i] === "{") return true;
  }
  return false;
}

function indexInTypeAliasAssignmentRhs(code: string, idx: number): boolean {
  for (const m of code.matchAll(new RegExp(`\\btype\\s+${IDENT}`, "gu"))) {
    let i = m.index! + m[0].length;
    i = skipWsCode(code, i);
    i = skipOptionalGenericTypeParams(code, i);
    i = skipWsCode(code, i);
    if (code[i] !== "=") continue;
    i = skipWsCode(code, i + 1);
    const start = i;
    for (;;) {
      i = skipTypeOperand(code, i);
      i = skipWsCode(code, i);
      const c = code[i];
      if (c === "&" || c === "|") {
        i++;
        continue;
      }
      if (c === ";" || c === undefined) break;
      break;
    }
    if (idx >= start && idx < i) return true;
  }
  return false;
}

function typeAliasRhsContainsBrace(code: string, openBrace: number): boolean {
  return indexInTypeAliasAssignmentRhs(code, openBrace);
}

function openBraceIsTypeMemberContext(code: string, openBrace: number): boolean {
  return interfaceBodyBraceIndex(code, openBrace) || typeAliasRhsContainsBrace(code, openBrace);
}

/** A `name(params): Return` member inside a type — not a runtime method. */
function parenListIsTypeMethodSignature(code: string, close: number): boolean {
  const i = skipWsCode(code, close + 1);
  if (code[i] !== ":") return false;
  const j = skipWsCode(code, i + 1);
  const next = code[j];
  return next !== ":" && next !== "=";
}

/** Single `|` or `&` before `(` — union/intersection type syntax, not `||` / `&&`. */
function prevCharIsSingleTypeUnionOrIntersection(code: string, openIdx: number): boolean {
  const p = prevNonWs(code, openIdx);
  if (p < 0) return false;
  const c = code[p]!;
  if (c !== "|" && c !== "&") return false;
  const q = prevNonWs(code, p);
  return !(q >= 0 && code[q] === c);
}

/** Flush `<` after an identifier starts a generic type argument list, not a comparison. */
function ltAtIsGenericOpener(code: string, ltIdx: number): boolean {
  const before = codePointBefore(code, ltIdx);
  return before !== undefined && isIdContinueCodePoint(before);
}

/** A `>` after `openIdx` that closes the `<` at `ltIdx`, ignoring the `>` in `=>`. */
function hasMatchingGenericCloserAfter(code: string, ltIdx: number, afterIdx: number): boolean {
  let depth = 0;
  for (let j = ltIdx; j < code.length; j++) {
    const c = code[j]!;
    if (c === "<") depth++;
    else if (c === ">") {
      if (j > 0 && code[j - 1] === "=") continue;
      depth--;
      if (depth === 0) return j > afterIdx;
    }
  }
  return false;
}

/** Index after the `>` that closes the type-parameter list opened at `ltIdx`. */
function indexAfterGenericTypeParamList(code: string, ltIdx: number): number {
  let depth = 0;
  for (let j = ltIdx; j < code.length; j++) {
    const c = code[j]!;
    if (c === "<") depth++;
    else if (c === ">") {
      if (j > 0 && code[j - 1] === "=") continue;
      depth--;
      if (depth === 0) return j + 1;
    }
  }
  return code.length;
}

function skipReturnTypeAfterParamList(code: string, i: number): number {
  if (code[i] !== ":") return i;
  return skipTypeAnnotation(code, i + 1);
}

/** Comma before `(` or `[` inside a generic or tuple type list — not a call argument comma. */
function commaBeforeOpenIsInTypeList(code: string, openIdx: number): boolean {
  const p = prevNonWs(code, openIdx);
  if (p < 0 || code[p] !== ",") return false;
  let angle = 0;
  let square = 0;
  let paren = 0;
  for (let i = p - 1; i >= 0; i--) {
    const c = code[i]!;
    if (c === ">") {
      if (i > 0 && code[i - 1] === "=") continue;
      angle++;
    } else if (c === "<") {
      angle--;
      if (
        angle < 0 &&
        square === 0 &&
        paren === 0 &&
        ltAtIsGenericOpener(code, i) &&
        hasMatchingGenericCloserAfter(code, i, openIdx)
      )
        return true;
    } else if (c === "]") square++;
    else if (c === "[") {
      square--;
      if (square < 0 && angle === 0 && paren === 0) {
        const prev = prevNonWs(code, i);
        if (prev >= 0) {
          const pc = code[prev]!;
          if (pc === ":" || pc === "|" || pc === "&" || pc === "<") return true;
          if (pc === "," && commaBeforeOpenIsInTypeList(code, i)) return true;
        }
      }
    } else if (c === ")") paren++;
    else if (c === "(") paren--;
  }
  return false;
}

/** A parenthesized parameter list in a type alias or similar — not a runtime callback. */
function openParenIsTypeSyntax(code: string, openIdx: number): boolean {
  if (indexInsideDeclareBlock(code, openIdx, "class")) {
    const close = matchingClose(code, openIdx);
    if (close !== -1 && parenListIsTypeMethodSignature(code, close)) return true;
  }
  if (indexInTypeAliasAssignmentRhs(code, openIdx)) return true;
  const before = code.slice(Math.max(0, openIdx - 400), openIdx);
  if (new RegExp(`(?<![\\w$.])interface\\s+${IDENT}(?:\\s*<[^>]*>)?(?:\\s+extends\\s+[^{;]*)?\\s*$`, "u").test(before))
    return true;
  let p = prevNonWs(code, openIdx);
  if (p >= 0 && code[p] === ":") return true;
  if (prevCharIsSingleTypeUnionOrIntersection(code, openIdx)) return true;
  if (commaBeforeOpenIsInTypeList(code, openIdx)) return true;
  if (p >= 0 && code[p] === "(") {
    const q = prevNonWs(code, p);
    if (q >= 0 && code[q] === ":") return true;
    return openParenIsTypeSyntax(code, p);
  }
  if (p >= 0 && /[\w$]/.test(code[p]!)) {
    let q = p;
    while (q >= 0 && /[\w$]/.test(code[q]!)) q--;
    q = prevNonWs(code, q + 1);
    if (q >= 0 && code[q] === "{") {
      if (openBraceIsTypeMemberContext(code, q)) return true;
    }
  }
  return false;
}

const PARAM_MODIFIER_RE = /^(?:(?:public|private|protected|readonly)\s+)+/u;

function singleParamBindingShadows(param: string, name: string): boolean {
  const esc = escapeRegExp(name);
  let trimmed = param.trim().replace(PARAM_MODIFIER_RE, "");
  if (!trimmed) return false;
  if (new RegExp(`^(?:\\.\\.\\.\\s*)?${esc}(?:\\s*:[^=,)]+|\\s*=[^,)]+|\\s*\\?|\\s*$)`, "u").test(trimmed)) return true;
  if (trimmed.startsWith("{")) {
    const close = matchingClose(trimmed, 0);
    if (close > 0) return destructuringPatternShadowsName(trimmed.slice(1, close), name);
  }
  if (trimmed.startsWith("[")) {
    const close = matchingClose(trimmed, 0);
    if (close > 0) return arrayPatternShadowsName(trimmed.slice(1, close), name);
  }
  return false;
}

function paramListShadowsName(inner: string, name: string): boolean {
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= inner.length; i++) {
    const c = inner[i];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      if (singleParamBindingShadows(inner.slice(start, i), name)) return true;
      start = i + 1;
    }
  }
  return singleParamBindingShadows(inner.slice(start), name);
}

/** Parameter list of each `function` declaration matched by `fnDeclPrefix`, after optional type params. */
function eachFnDeclParamListAfterName(
  code: string,
  fnDeclPrefix: string,
  onList: (paramInner: string, fnKeywordIndex: number) => boolean,
): boolean {
  for (const m of code.matchAll(new RegExp(`${fnDeclPrefix}${IDENT}`, "gu"))) {
    const fnIdx = code.indexOf("function", m.index!);
    if (fnIdx === -1 || fnIdx > m.index! + m[0].length) continue;
    let i = m.index! + m[0].length;
    i = skipWsCode(code, i);
    if (code[i] === "<") {
      i = indexAfterGenericTypeParamList(code, i);
      i = skipWsCode(code, i);
    }
    if (code[i] !== "(") continue;
    const open = i;
    const close = matchingClose(code, open);
    if (close === -1) continue;
    if (onList(code.slice(open + 1, close), fnIdx)) return true;
  }
  return false;
}

/** Arrows after an object-property `:` or a ternary `:` are not scanned (e.g. `{ load: (make) => ... }`, `c ? g : (make) => ...`). */
/** Whether a `catch (` binding shadows `name`, scanning left-to-right without nested-regex quantifiers. */
function anyCatchBindingShadowsName(code: string, name: string): boolean {
  for (let i = 0; i + 5 <= code.length; i++) {
    if (code.slice(i, i + 5) !== "catch") continue;
    if (i > 0 && /[\w$.]/.test(code[i - 1]!)) continue;
    const afterWord = i + 5;
    if (afterWord < code.length && /[\w$]/.test(code[afterWord]!)) continue;
    const open = skipWsCode(code, afterWord);
    if (code[open] !== "(") continue;
    const close = matchingClose(code, open);
    if (close === -1) return false;
    if (singleParamBindingShadows(code.slice(open + 1, close), name)) return true;
  }
  return false;
}

function forEachParenListShadows(code: string, name: string): boolean {
  for (let i = 0; i < code.length; i++) {
    if (code[i] !== "(") continue;
    const open = i;
    const close = matchingClose(code, open);
    if (close === -1) continue;
    const after = skipWsCode(code, close + 1);
    if (code[after] !== "=" || code[after + 1] !== ">") continue;
    if (openParenIsTypeSyntax(code, open)) continue;
    if (paramListShadowsName(code.slice(open + 1, close), name)) return true;
  }
  return false;
}

/** Ambient or type-only `{ name(` forms — not class or object-literal methods. */
function objectMethodBraceIsTypeOnly(code: string, openBrace: number): boolean {
  if (openBraceIsDeclareClassBody(code, openBrace)) return true;
  if (indexInsideDeclareBlock(code, openBrace + 1, "class")) return true;
  if (openBraceIsTypeMemberContext(code, openBrace)) return true;
  const before = code.slice(Math.max(0, openBrace - 120), openBrace);
  if (new RegExp(`(?<![\\w$.])interface\\s+${IDENT}(?:\\s*<[^>]*>)?(?:\\s+extends\\s+[^{;]*)?\\s*$`, "u").test(before))
    return true;
  if (new RegExp(`(?<![\\w$.])type\\s+${IDENT}(?:\\s*<[^{};]*)?\\s*=\\s*[^{;]*$`, "u").test(before)) return true;
  return false;
}

/** Type-only object/class member context when the lead is `{`, `,`, `;`, or `}`. */
function objectMethodContextIsTypeOnly(code: string, memberLeadIdx: number): boolean {
  if (code[memberLeadIdx] === "{") return objectMethodBraceIsTypeOnly(code, memberLeadIdx);
  const open = enclosingOpener(code, memberLeadIdx);
  if (open === -1 || code[open] !== "{") return false;
  return objectMethodBraceIsTypeOnly(code, open);
}

/** Each `{|,|;|}`-led method name, optional type params, and `(` — generic lists use full depth walk. */
function forEachObjectMethodParamList(
  code: string,
  onMethod: (parenOpen: number, memberLeadIdx: number) => boolean | void,
): boolean {
  for (let lead = 0; lead < code.length; lead++) {
    const c = code[lead];
    if (c !== "{" && c !== "," && c !== ";" && c !== "}") continue;
    let i = skipWsCode(code, lead + 1);
    const methodStart = i;
    i = skipIdentCode(code, i);
    if (i === methodStart) continue;
    const methodName = code.slice(methodStart, i);
    if (CONTROL_FLOW_BLOCK_KEYWORDS.has(methodName)) continue;
    i = skipWsCode(code, i);
    if (code[i] === "<" && ltAtIsGenericOpener(code, i)) {
      i = indexAfterGenericTypeParamList(code, i);
      i = skipWsCode(code, i);
    }
    if (code[i] !== "(") continue;
    if (onMethod(i, lead) === true) return true;
  }
  return false;
}

function collectLocalShadowedCalleepNames(
  code: string,
  writerLocalNames: Set<string>,
  writerRequireDestructureDeclSpans: { start: number; end: number }[],
): Set<string> {
  const shadowed = new Set<string>();
  const fnDeclPrefix = `${CALLEE_BOUNDARY}(?:export\\s+default\\s+)?(?:async\\s+)?function\\s*(?:\\*\\s*)?`;
  for (const name of writerLocalNames) {
    const esc = escapeRegExp(name);
    for (const m of code.matchAll(new RegExp(`${fnDeclPrefix}${esc}${NOT_ID_CONTINUE}`, "gu"))) {
      const fnIdx = code.indexOf("function", m.index!);
      if (fnIdx !== -1 && skipFunctionParamValueBinding(code, fnIdx)) continue;
      shadowed.add(name);
      break;
    }
    if (new RegExp(`${CALLEE_BOUNDARY}class\\s+${esc}${NOT_ID_CONTINUE}`, "u").test(code)) shadowed.add(name);
    if (new RegExp(`${CALLEE_BOUNDARY}(?:const|let|var)\\s+${esc}(?:\\s*:[^=;]*)?\\s*=`, "u").test(code)) shadowed.add(name);
    if (new RegExp(`${CALLEE_BOUNDARY}(?:const|let|var)\\s+${esc}(?:\\s*:[^=;]+)?\\s*;`, "u").test(code)) shadowed.add(name);
    if (new RegExp(`${CALLEE_BOUNDARY}(?:const|let|var)\\s+[^;]+?,\\s*${esc}(?:\\s*:[^=;]*)?\\s*=`, "u").test(code))
      shadowed.add(name);
    if (new RegExp(`${CALLEE_BOUNDARY}using\\s+${esc}(?:\\s*<[^>]*)?\\s*=`, "u").test(code)) shadowed.add(name);
    if (
      new RegExp(
        `${CALLEE_BOUNDARY}for\\s+(?:await\\s+)?\\(\\s*(?:const|let|var)\\s+${esc}(?:\\s*:[^;)]+)?\\s*(?:of|in)\\b`,
        "u",
      ).test(code)
    )
      shadowed.add(name);
    for (const m of code.matchAll(new RegExp(`${CALLEE_BOUNDARY}(?:const|let|var)\\s*\\{`, "gu"))) {
      if (writerRequireDestructureDeclSpans.some((s) => m.index! >= s.start && m.index! < s.end)) continue;
      const open = m.index! + m[0].length - 1;
      const close = matchingClose(code, open);
      if (close === -1) continue;
      if (destructuringPatternShadowsName(code.slice(open + 1, close), name)) shadowed.add(name);
    }
    for (const m of code.matchAll(new RegExp(`${CALLEE_BOUNDARY}(?:const|let|var)\\s*\\[`, "gu"))) {
      const open = m.index! + m[0].length - 1;
      const close = matchingClose(code, open);
      if (close === -1) continue;
      if (arrayPatternShadowsName(code.slice(open + 1, close), name)) shadowed.add(name);
    }
    if (new RegExp(`${fnDeclPrefix}${IDENT}\\s*\\([^)]*\\.\\.\\.\\s*${esc}${NOT_ID_CONTINUE}`, "u").test(code))
      shadowed.add(name);
    const boundParam = `(?:\\.\\.\\.\\s*)?${esc}(?:\\?(?:\\s*[,):]|=|:)|(?![\\w$])\\s*(?:[,):]|=|:))`;
    const firstParamBind = `\\(\\s*${boundParam}`;
    const laterParamBind = `,\\s*(?:\\.\\.\\.\\s*)?${esc}(?:\\?(?:\\s*[,):]|=|:)|(?![\\w$])\\s*(?:[,):]|=|:))`;
    const fnNamed = `${IDENT}\\s*(?:<[^>]*>)?\\s*${firstParamBind}`;
    const fnDeclParamRes = [
      new RegExp(`${fnDeclPrefix}${fnNamed}`, "gu"),
      new RegExp(`${fnDeclPrefix}\\s*${firstParamBind}`, "gu"),
      new RegExp(`${fnDeclPrefix}${IDENT}\\s*(?:<[^>]*>)?\\s*\\([^)]*${laterParamBind}`, "gu"),
      new RegExp(`${fnDeclPrefix}\\s*\\([^)]*${laterParamBind}`, "gu"),
      new RegExp(`${fnDeclPrefix}${IDENT}\\s*(?:<[^>]*>)?\\s*\\(\\s*\\{[^}]*${esc}`, "gu"),
      new RegExp(`${fnDeclPrefix}${IDENT}\\s*(?:<[^>]*>)?\\s*\\(\\s*\\[[^\\]]*${esc}`, "gu"),
    ];
    let fnParamShadow = false;
    for (const re of fnDeclParamRes) {
      for (const m of code.matchAll(re)) {
        const fnIdx = code.indexOf("function", m.index!);
        if (fnIdx === -1 || fnIdx > m.index! + m[0].length) continue;
        if (skipFunctionParamValueBinding(code, fnIdx)) continue;
        fnParamShadow = true;
        break;
      }
      if (fnParamShadow) break;
    }
    if (fnParamShadow) shadowed.add(name);
    if (!shadowed.has(name)) {
      for (const m of code.matchAll(/constructor\s*\(/gu)) {
        if (constructorInDeclareClass(code, m.index!)) continue;
        const open = m.index! + m[0].length - 1;
        const close = matchingClose(code, open);
        if (close === -1) continue;
        if (paramListShadowsName(code.slice(open + 1, close), name)) {
          shadowed.add(name);
          break;
        }
      }
    }
    if (
      !shadowed.has(name) &&
      eachFnDeclParamListAfterName(code, fnDeclPrefix, (inner, fnIdx) => {
        if (skipFunctionParamValueBinding(code, fnIdx)) return false;
        return paramListShadowsName(inner, name);
      })
    ) {
      shadowed.add(name);
    }
    if (
      !shadowed.has(name) &&
      forEachObjectMethodParamList(code, (parenOpen, memberLeadIdx) => {
        if (objectMethodContextIsTypeOnly(code, memberLeadIdx)) return false;
        if (openParenIsTypeSyntax(code, parenOpen)) return false;
        const close = matchingClose(code, parenOpen);
        if (close === -1) return false;
        if (paramListShadowsName(code.slice(parenOpen + 1, close), name)) return true;
        return false;
      })
    ) {
      shadowed.add(name);
    }
    if (new RegExp(`${CALLEE_BOUNDARY}(?:const|let|var)\\s+${IDENT}\\s*=\\s*(?:async\\s+)?${esc}\\s*=>`, "u").test(code))
      shadowed.add(name);
    if (new RegExp(`${CALLEE_BOUNDARY}(?:const|let|var)\\s+${IDENT}\\s*=\\s*(?:async\\s+)?${firstParamBind}\\s*=>`, "u").test(code))
      shadowed.add(name);
    if (!shadowed.has(name)) {
      for (const m of code.matchAll(
        new RegExp(`${CALLEE_BOUNDARY}(?:const|let|var)\\s+${IDENT}\\s*=\\s*(?:async\\s+)?(?:<[^>]*>\\s*)?\\(\\s*`, "gu"),
      )) {
        const open = m.index! + m[0].length - 1;
        const close = matchingClose(code, open);
        if (close === -1) continue;
        if (paramListShadowsName(code.slice(open + 1, close), name)) {
          shadowed.add(name);
          break;
        }
      }
    }
    if (!shadowed.has(name)) {
      for (const m of code.matchAll(/=>\s*(?:async\s+)?(?:<[^>]*>\s*)?\(\s*/gu)) {
        const open = m.index! + m[0].length - 1;
        if (openParenIsTypeSyntax(code, open)) continue;
        const close = matchingClose(code, open);
        if (close === -1) continue;
        if (paramListShadowsName(code.slice(open + 1, close), name)) {
          shadowed.add(name);
          break;
        }
      }
    }
    if (!shadowed.has(name)) {
      if (new RegExp(`=>\\s*(?:async\\s+)?(?:<[^>]*>\\s*)?${esc}\\s*=>`, "u").test(code)) shadowed.add(name);
    }
    if (
      new RegExp(
        `${CALLEE_BOUNDARY}(?:const|let|var)\\s+${IDENT}\\s*=\\s*(?:async\\s+)?\\(\\s*${esc}\\s*:\\s*\\([^)]*\\)\\s*=>\\s*[^)]*\\)\\s*=>`,
        "u",
      ).test(code)
    )
      shadowed.add(name);
    if (!shadowed.has(name)) {
      for (const m of code.matchAll(
        new RegExp(`${CALLEE_BOUNDARY}(?:const|let|var)\\s+${IDENT}\\s*=\\s*(?:async\\s+)?(?:<[^>]*>\\s*)?\\(`, "gu"),
      )) {
        const open = m.index! + m[0].length - 1;
        const close = matchingClose(code, open);
        if (close === -1) continue;
        const after = nextNonWs(code, close + 1);
        if (code.slice(after, after + 2) !== "=>") continue;
        if (paramListShadowsName(code.slice(open + 1, close), name)) {
          shadowed.add(name);
          break;
        }
      }
    }
    if (new RegExp(`${CALLEE_BOUNDARY}\\(\\s*${esc}(?:\\s*:[^)]*)?\\)\\s*:[^=>]+\\s*=>`, "u").test(code)) shadowed.add(name);
    if (new RegExp(`${CALLEE_BOUNDARY}export\\s+default\\s+(?:async\\s+)?\\(\\s*${esc}(?:\\s*:[^)]*)?\\)`, "u").test(code))
      shadowed.add(name);
    if (!shadowed.has(name) && forEachParenListShadows(code, name)) shadowed.add(name);
    if (new RegExp(`${CALLEE_BOUNDARY}(?:const|let|var)\\s+${IDENT}\\s*=\\s*(?:async\\s+)?\\(\\s*\\[\\s*${esc}`, "u").test(code))
      shadowed.add(name);
    if (new RegExp(`${CALLEE_BOUNDARY}(?:const|let|var)\\s+${IDENT}\\s*=\\s*(?:async\\s+)?\\[\\s*${esc}\\s*=>`, "u").test(code))
      shadowed.add(name);
    if (anyCatchBindingShadowsName(code, name)) shadowed.add(name);
  }
  return shadowed;
}

/**
 * Whether the `{` at `open` opens a destructuring pattern or a type rather
 * than an object literal — so `const { approvedBy } = entry`, a parameter
 * pattern, an `interface`/`type` body, a type annotation or a class body is
 * never mistaken for code that SETS approval. Local and approximate: an
 * annotation that follows a `,`-separated destructured parameter outside
 * parentheses, or a pattern shape not listed here, is treated as an object
 * literal (a false positive, never a silent miss).
 */
function braceIsPatternOrType(code: string, open: number): boolean {
  const before = code.slice(Math.max(0, open - 400), open);
  if (/(?<![\w$.])(?:const|let|var)\s*$/.test(before)) return true;
  if (new RegExp(`(?<![\\w$.])interface\\s+${IDENT}(?:\\s*<[^>]*>)?(?:\\s+extends\\s+[^{};]*)?\\s*$`).test(before)) return true;
  if (new RegExp(`(?<![\\w$.])type\\s+${IDENT}(?:\\s*<[^{};]*>)?\\s*=\\s*$`).test(before)) return true;
  if (new RegExp(`(?<![\\w$.])class(?![\\w$])(?:\\s+${IDENT})?[^{};()]*$`).test(before)) return true;
  if (/(?<![\w$.])(?:as|satisfies)\s*$/.test(before)) return true;
  if (/\)\s*:\s*$/.test(before)) return true; // a return-type annotation
  if (new RegExp(`(?<![\\w$.])(?:const|let|var)\\s+${IDENT}\\s*:\\s*$`).test(before)) return true;
  if (new RegExp(`[(,]\\s*${IDENT}\\s*\\??\\s*:\\s*$`).test(before) && code[enclosingOpener(code, open)] === "(") return true;
  if (/(?<![\w$.])function\b[^(){};]*\(\s*$/.test(before)) return true;
  const close = matchingClose(code, open);
  if (close === -1) return false;
  const after = code.slice(close + 1, close + 400);
  if (/^\s*=(?![=>])/.test(after)) return true;
  if (/^\s*(?::[^(){};=]*)?\)\s*(?::[^{};=]*)?(?:=>|\{)/.test(after)) return true; // an arrow or method parameter
  if (/^\s*(?:of|in)\b/.test(after)) return true;
  return false;
}

/** Whether `idx` sits inside a pattern or type, walking up through nested property values a few levels. */
function inPatternOrType(code: string, idx: number): boolean {
  let pos = idx;
  for (let level = 0; level < 6; level++) {
    const open = enclosingOpener(code, pos);
    if (open === -1 || code[open] !== "{") return false;
    if (braceIsPatternOrType(code, open)) return true;
    const prev = prevNonWs(code, open);
    const c = prev === -1 ? undefined : code[prev];
    if (c !== ":" && c !== "," && c !== "{") return false;
    pos = open;
  }
  return false;
}

/** Whether position `idx` (a key's first character) is a property key position inside an object literal: preceded by `{` or `,`, directly enclosed by `{`, not a pattern or type. */
function isObjectKeyPosition(code: string, idx: number): boolean {
  const prev = prevNonWs(code, idx);
  if (prev === -1 || (code[prev] !== "{" && code[prev] !== ",")) return false;
  if (code[enclosingOpener(code, idx)] !== "{") return false;
  return !inPatternOrType(code, idx);
}

function isApprovedLiteral(lit: MaskedLiteral | undefined): boolean {
  if (!lit) return false;
  if (lit.kind === "template" && lit.raw.includes("${")) return false;
  return lit.text === "approved";
}

/** A string literal, or a template literal with no interpolation — the only arguments this gate treats as a known specifier. */
function isPlainLiteral(lit: MaskedLiteral | undefined): lit is MaskedLiteral {
  return lit !== undefined && (lit.kind === "string" || !lit.raw.includes("${"));
}

// ------------------------------------------------------------- extraction

interface Specifier {
  lit: MaskedLiteral;
  form: "static" | "bare" | "export-from" | "require" | "import-equals" | "dynamic";
  /** For `static`/`export-from`: index of the `import`/`export` keyword. For require/dynamic: index of the callee. */
  stmtStart: number;
}

/**
 * Pure — no I/O beyond `existsSync`/`realpathSync` for relative-specifier
 * resolution. Decides whether `content` is registry-coupled and, if so,
 * reports every approval-bypass finding and unchecked position in it.
 * `filePath` is the path reported in results (and picks JSX masking for a
 * `.tsx`/`.jsx` name); `context.absoluteFilePath` is where relative
 * specifiers resolve from.
 */
export function extractApprovalBypass(
  content: string,
  filePath: string,
  context: { registryPath: string; absoluteFilePath: string },
): ApprovalBypassExtractResult {
  const mask = maskNonCode(content, filePath);
  if (mask.failure !== undefined) return { coupled: false, findings: [], unchecked: [], parseFailure: mask.failure };
  const { code, literals } = mask;

  const registryReal = realOrResolved(context.registryPath);
  const registryBase = basename(registryReal);
  const fileDir = dirname(resolve(context.absoluteFilePath));

  const lineStarts = [0];
  for (let i = 0; i < content.length; i++) if (content[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (offset: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const litAt = new Map<number, MaskedLiteral>();
  for (const lit of literals) litAt.set(lit.start, lit);
  /** Next non-blank position in `code`, stopping at a masked literal's start (a literal is blank in `code`, so plain `nextNonWs` would skip it). */
  const nextTokenStart = (idx: number): number => {
    let i = idx;
    while (i < code.length && isWs(code[i]) && !litAt.has(i)) i++;
    return i;
  };

  const isRegistry = (s: string): boolean => {
    if (s.startsWith("./") || s.startsWith("../")) return realOrResolved(resolve(fileDir, s)) === registryReal;
    return s === registryBase || s.endsWith(`/${registryBase}`);
  };
  const isWriter = (s: string): boolean => s === "@clossys/writer" || s.startsWith("@clossys/writer/");

  // ---- 1. classify every literal that is an import/require specifier
  const specifiers: Specifier[] = [];
  const specifierStarts = new Set<number>();
  for (const lit of literals) {
    if (!isPlainLiteral(lit)) continue;
    const before = code.slice(Math.max(0, lit.start - 2000), lit.start);
    const base = lit.start - before.length;
    const after = code.slice(lit.end, lit.end + 40);
    let spec: Specifier | undefined;
    if (lit.kind === "string" && /(?<![\w$.])from\s*$/.test(before)) {
      const kw = [...before.matchAll(/(?<![\w$.])(import|export)(?![\w$])/g)].pop();
      if (kw) spec = { lit, form: kw[1] === "import" ? "static" : "export-from", stmtStart: base + kw.index! };
    } else if (lit.kind === "string" && /(?<![\w$.])import\s*$/.test(before)) {
      spec = { lit, form: "bare", stmtStart: base + before.search(/import\s*$/) };
    } else if (/(?<![\w$.])require\s*\(\s*$/.test(before) && /^\s*\)/.test(after)) {
      const callee = base + before.search(/require\s*\(\s*$/);
      const eq = new RegExp(`(?<![\\w$.])import\\s+(?:type\\s+)?${IDENT}\\s*=\\s*$`).exec(code.slice(Math.max(0, callee - 200), callee));
      spec = eq
        ? { lit, form: "import-equals", stmtStart: Math.max(0, callee - 200) + eq.index }
        : { lit, form: "require", stmtStart: callee };
    } else if (/(?<![\w$.])import\s*\(\s*$/.test(before) && /^\s*[),]/.test(after)) {
      spec = { lit, form: "dynamic", stmtStart: base + before.search(/import\s*\(\s*$/) };
    }
    if (spec) {
      specifiers.push(spec);
      specifierStarts.add(lit.start);
    }
  }

  const coupled = specifiers.some((s) => isWriter(s.lit.text) || isRegistry(s.lit.text));
  if (!coupled) return { coupled: false, findings: [], unchecked: [] };

  const writerImports = collectWriterCalleeImports(specifiers, isWriter, code);
  const writerRequireDestructureDeclSpans = writerRequireDestructureSpans(specifiers, isWriter, code);
  const localShadowedCalleepNames = collectLocalShadowedCalleepNames(
    code,
    writerImports.localNames,
    writerRequireDestructureDeclSpans,
  );

  const findings: ApprovalBypassFinding[] = [];
  const unchecked: ApprovalBypassUncheckedItem[] = [];
  const finding = (rule: ApprovalBypassRule, offset: number, detail: string): void => {
    findings.push({ rule, severity: "error", file: filePath, line: lineOf(offset), detail });
  };
  const uncheckedAt = (kind: string, offset: number, detail: string): void => {
    unchecked.push({ file: filePath, line: lineOf(offset), kind, detail });
  };

  // ---- 2. registry loads: bindings to trace, and loads this gate cannot trace
  const bindings: {
    name: string;
    declStart: number;
    declEnd: number;
    fromParsedRegistry: boolean;
    parseRegistryAssign: boolean;
  }[] = [];
  for (const spec of specifiers) {
    if (!isRegistry(spec.lit.text)) continue;
    const at = spec.lit.start;
    switch (spec.form) {
      case "bare":
        break; // a side-effect import binds nothing
      case "export-from": {
        if (/^\s*type\b/.test(code.slice(spec.stmtStart + "export".length, at))) break;
        uncheckedAt("registry-reexport", at, "registry re-export is not traced by this gate");
        break;
      }
      case "static": {
        const clause = code.slice(spec.stmtStart + "import".length, at).replace(/\bfrom\s*$/, "").trim();
        if (/^type\s+(?!,)/.test(clause) && clause !== "type") break; // type-only import: no runtime data
        const decl = { declStart: spec.stmtStart, declEnd: spec.lit.end };
        const def = new RegExp(`^(${IDENT})\\s*(?:,|$)`).exec(clause);
        if (def) bindings.push({ name: def[1]!, ...decl, fromParsedRegistry: false, parseRegistryAssign: false });
        const ns = new RegExp(`\\*\\s*as\\s+(${IDENT})`).exec(clause);
        if (ns) bindings.push({ name: ns[1]!, ...decl, fromParsedRegistry: false, parseRegistryAssign: false });
        const named = /\{([^}]*)\}/.exec(clause);
        if (named) {
          for (const part of named[1]!.split(",")) {
            // A string-literal imported name (`{ "x" as y }`) is masked, leaving only `as y`.
            const m = new RegExp(`^\\s*(type\\s+)?(${IDENT})?\\s*(?:as\\s+(${IDENT}))?\\s*$`).exec(part);
            if (!m || m[1]) continue;
            const imported = m[2];
            const local = m[3] ?? imported;
            if (local === undefined) continue;
            if (imported === "default") {
              bindings.push({ name: local, ...decl, fromParsedRegistry: false, parseRegistryAssign: false });
            } else {
              finding(
                "copy-read-without-resolver",
                at,
                `named import "${local}" reads registry content directly; import the registry whole and pass it to createCopyResolver`,
              );
            }
          }
        }
        break;
      }
      case "import-equals": {
        const m = new RegExp(`import\\s+(?:type\\s+)?(${IDENT})\\s*=`).exec(code.slice(spec.stmtStart, at));
        if (m)
          bindings.push({
            name: m[1]!,
            declStart: spec.stmtStart,
            declEnd: spec.lit.end,
            fromParsedRegistry: false,
            parseRegistryAssign: false,
          });
        break;
      }
      case "require": {
        const pre = code.slice(Math.max(0, spec.stmtStart - 200), spec.stmtStart);
        const decl = new RegExp(`(?<![\\w$.])(?:const|let|var)\\s+(${IDENT})\\s*=\\s*$`).exec(pre);
        const close = code.indexOf(")", spec.lit.end);
        // Bound only when the call is the whole initializer: `const x = require("...")` followed by `;`, `,`, `}`, a line break or EOF.
        const bound = decl !== null && /^[ \t]*(?:[;,}\r\n]|$)/.test(code.slice(close + 1));
        if (decl !== null && bound) {
          bindings.push({
            name: decl[1]!,
            declStart: Math.max(0, spec.stmtStart - 200) + decl.index,
            declEnd: close + 1,
            fromParsedRegistry: false,
            parseRegistryAssign: false,
          });
        } else {
          uncheckedAt("registry-require-unbound", at, "require of registry is not bound to a plain identifier, so its use cannot be traced");
        }
        break;
      }
      case "dynamic":
        uncheckedAt("registry-dynamic-import", at, "dynamic import of registry — the loaded module's use is not traced by this gate");
        break;
    }
  }

  for (const m of code.matchAll(
    new RegExp(`${CALLEE_BOUNDARY}(?:const|let|var)\\s+(${IDENT})(?:\\s*:[^=;]+)?\\s*=\\s*${CALLEE_BOUNDARY}parseCopyRegistry\\s*\\(`, "gu"),
  )) {
    const name = m[1]!;
    const declStart = m.index!;
    const openParen = code.indexOf("(", m.index + m[0].length - 1);
    const close = matchingClose(code, openParen);
    if (close === -1) continue;
    const parseCall = { open: openParen, close };
    const afterClose = nextNonWs(code, close + 1);
    const endsAtParse =
      parseCopyRegistryBindingInitEndsAtCall(code, parseCall) && !postfixContinuesParseResult(code, afterClose);
    bindings.push({
      name,
      declStart,
      declEnd: close + 1,
      fromParsedRegistry: endsAtParse,
      parseRegistryAssign: true,
    });
  }

  // ---- 3. import(...) / require(...) calls whose argument is not a plain literal
  for (const m of code.matchAll(/(?<![\w$.])(import|require)\s*\(/g)) {
    const argStart = nextTokenStart(m.index + m[0].length);
    const lit = litAt.get(argStart);
    const plain = isPlainLiteral(lit) && specifierStarts.has(argStart);
    if (plain) continue;
    if (m[1] === "import") {
      uncheckedAt("dynamic-import-non-literal", m.index, "dynamic import() with a computed argument could load the registry; not traced by this gate");
    } else {
      uncheckedAt("require-non-literal", m.index, "require() with a computed argument could load the registry; not traced by this gate");
    }
  }

  // ---- 4. copy-read-without-resolver: every use of a registry binding
  for (const b of bindings) {
    const re = new RegExp(`(?<![\\w$])${escapeRegExp(b.name)}(?![\\w$])`, "g");
    for (const m of code.matchAll(re)) {
      const i = m.index;
      if (i >= b.declStart && i < b.declEnd) continue;
      const prev = prevNonWs(code, i);
      if (prev >= 0 && code[prev] === "." && !(code[prev - 1] === "." && code[prev - 2] === ".")) continue; // `obj.name` — a property, not the binding
      if (bindingFollowsTypeofQuery(code, i)) continue; // a type query reads no content
      const afterName = code.slice(i + b.name.length, i + b.name.length + 20);
      if (/^\s*:(?!:)/.test(afterName) && isObjectKeyPosition(code, i)) continue; // `{ name: ... }` — a key, not the binding
      if (
        registryBindingUseAllowed(
          code,
          i,
          b.name.length,
          b.fromParsedRegistry,
          b.parseRegistryAssign,
          writerImports,
          localShadowedCalleepNames,
        )
      )
        continue;
      finding(
        "copy-read-without-resolver",
        i,
        `registry binding "${b.name}" is used outside createCopyResolver/resolveCopyRef/parseCopyRegistry/validateCopyRegistryShape — copy read this way skips the approval lifecycle`,
      );
    }
  }

  // ---- 5. approval-set-in-code
  const flagged = new Set<number>();
  const flagApproval = (keyOffset: number, detail: string): void => {
    if (flagged.has(keyOffset)) return;
    flagged.add(keyOffset);
    finding("approval-set-in-code", keyOffset, detail);
  };
  const literalAfter = (idx: number): MaskedLiteral | undefined => litAt.get(nextTokenStart(idx));

  // 5a. identifier keys and member assignments
  for (const m of code.matchAll(/(?<![\w$])(approvedBy|pendingOwnerReview|status)(?![\w$])/g)) {
    const name = m[1]!;
    const i = m.index;
    const end = i + name.length;
    const prev = prevNonWs(code, i);
    const isMember = prev >= 0 && code[prev] === "." && code[prev - 1] !== ".";
    const rest = code.slice(end, end + 20);
    if (isMember) {
      if (code[prev - 1] === "?") continue; // `x?.name` can never be assigned
      const op = ASSIGN_OP_RE.exec(rest);
      if (!op) continue;
      if (name === "status") {
        if (isApprovedLiteral(literalAfter(end + op[0].length))) flagApproval(i, `status is assigned "approved" in code`);
      } else {
        flagApproval(i, `${name} is assigned in code`);
      }
      continue;
    }
    const colon = /^\s*:(?!:)/.exec(rest);
    if (colon) {
      if (!isObjectKeyPosition(code, i)) continue;
      if (name === "status") {
        if (isApprovedLiteral(literalAfter(end + colon[0].length))) flagApproval(i, `status is set to "approved" in an object literal`);
      } else {
        flagApproval(i, `${name} is set in an object literal`);
      }
      continue;
    }
    // shorthand `{ approvedBy }` / `{ a, pendingOwnerReview }`
    if (name !== "status" && /^\s*[,}]/.test(rest) && isObjectKeyPosition(code, i)) {
      flagApproval(i, `${name} is set in an object literal (shorthand property)`);
    }
  }

  // 5b. quoted and computed keys: the key is itself a literal
  for (const lit of literals) {
    if (!isPlainLiteral(lit)) continue;
    if (lit.text !== "status" && !APPROVAL_KEYS.has(lit.text)) continue;
    if (specifierStarts.has(lit.start)) continue;
    const name = lit.text;
    const prev = prevNonWs(code, lit.start);
    const bracketed = prev >= 0 && code[prev] === "[";
    let valueFrom: number | undefined;
    let where = "";
    if (bracketed) {
      const close = nextNonWs(code, lit.end);
      if (code[close] !== "]") continue;
      const rest = code.slice(close + 1, close + 20);
      const colon = /^\s*:(?!:)/.exec(rest);
      const op = ASSIGN_OP_RE.exec(rest);
      if (colon && isObjectKeyPosition(code, prev)) {
        valueFrom = close + 1 + colon[0].length;
        where = "a computed object key";
      } else if (op && prevNonWs(code, prev) >= 0 && /[\w$)\]]/.test(code[prevNonWs(code, prev)]!)) {
        valueFrom = close + 1 + op[0].length;
        where = "a bracket member assignment";
      } else continue;
    } else {
      const colon = /^\s*:(?!:)/.exec(code.slice(lit.end, lit.end + 20));
      if (!colon || !isObjectKeyPosition(code, lit.start)) continue;
      valueFrom = lit.end + colon[0].length;
      where = "a quoted object key";
    }
    if (name === "status") {
      if (isApprovedLiteral(literalAfter(valueFrom))) flagApproval(lit.start, `status is set to "approved" via ${where}`);
    } else {
      flagApproval(lit.start, `${name} is set via ${where}`);
    }
  }

  // ---- 6. any other string that names the registry file
  for (const lit of literals) {
    if (specifierStarts.has(lit.start)) continue;
    if (!lit.text.includes(registryBase)) continue;
    uncheckedAt("registry-path-string", lit.start, "registry path string — a load through it is not traced by this gate");
  }

  findings.sort((a, b) => a.line - b.line);
  unchecked.sort((a, b) => a.line - b.line);
  return { coupled: true, findings, unchecked };
}

// ------------------------------------------------------------------- gate

/** Pure — decides the ternary verdict from an already-computed scan. Never throws. See "THE TERNARY" above. */
export function checkApprovalBypass(scan: ApprovalBypassScanResult): ApprovalBypassGateResult {
  const reasons: string[] = [];
  if (scan.filesScanned === 0) {
    reasons.push(scan.parseFailures.length > 0 ? "every matched file failed to parse — nothing was actually scanned" : "no source files were scanned");
  } else if (scan.parseFailures.length > 0) {
    reasons.push(`${scan.parseFailures.length} matched file(s) could not be parsed and were never examined`);
  }
  if (scan.unchecked.length > 0) {
    reasons.push(`${scan.unchecked.length} registry load or reference(s) in coupled files could not be traced`);
  }
  const base = { findings: scan.findings, unchecked: scan.unchecked };
  if (scan.findings.length > 0) return { verdict: "violated", reasons, ...base };
  if (reasons.length > 0) return { verdict: "indeterminate", reasons, ...base };
  return { verdict: "satisfied", reasons, ...base };
}
