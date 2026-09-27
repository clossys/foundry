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
 *    `resolveCopyRef`, `parseCopyRegistry` or `validateCopyRegistryShape`).
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
const RESOLVER_CALL_RE = /(?:createCopyResolver|resolveCopyRef|parseCopyRegistry|validateCopyRegistryShape)\s*\(\s*$/;
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

function matchingClose(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
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
  if (new RegExp(`(?<![\\w$.])interface\\s+${IDENT}(?:\\s*<[^{}]*>)?(?:\\s+extends\\s+[^{};]*)?\\s*$`).test(before)) return true;
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

  const findings: ApprovalBypassFinding[] = [];
  const unchecked: ApprovalBypassUncheckedItem[] = [];
  const finding = (rule: ApprovalBypassRule, offset: number, detail: string): void => {
    findings.push({ rule, severity: "error", file: filePath, line: lineOf(offset), detail });
  };
  const uncheckedAt = (kind: string, offset: number, detail: string): void => {
    unchecked.push({ file: filePath, line: lineOf(offset), kind, detail });
  };

  // ---- 2. registry loads: bindings to trace, and loads this gate cannot trace
  const bindings: { name: string; declStart: number; declEnd: number }[] = [];
  for (const spec of specifiers) {
    if (!isRegistry(spec.lit.text)) continue;
    const at = spec.lit.start;
    switch (spec.form) {
      case "bare":
        break; // a side-effect import binds nothing
      case "export-from": {
        if (/^\s*type\b/.test(code.slice(spec.stmtStart + "export".length, at))) break;
        uncheckedAt("registry-reexport", at, `registry ${spec.lit.raw} is re-exported; whoever imports it is not traced by this gate`);
        break;
      }
      case "static": {
        const clause = code.slice(spec.stmtStart + "import".length, at).replace(/\bfrom\s*$/, "").trim();
        if (/^type\s+(?!,)/.test(clause) && clause !== "type") break; // type-only import: no runtime data
        const decl = { declStart: spec.stmtStart, declEnd: spec.lit.end };
        const def = new RegExp(`^(${IDENT})\\s*(?:,|$)`).exec(clause);
        if (def) bindings.push({ name: def[1]!, ...decl });
        const ns = new RegExp(`\\*\\s*as\\s+(${IDENT})`).exec(clause);
        if (ns) bindings.push({ name: ns[1]!, ...decl });
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
              bindings.push({ name: local, ...decl });
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
        if (m) bindings.push({ name: m[1]!, declStart: spec.stmtStart, declEnd: spec.lit.end });
        break;
      }
      case "require": {
        const pre = code.slice(Math.max(0, spec.stmtStart - 200), spec.stmtStart);
        const decl = new RegExp(`(?<![\\w$.])(?:const|let|var)\\s+(${IDENT})\\s*=\\s*$`).exec(pre);
        const close = code.indexOf(")", spec.lit.end);
        // Bound only when the call is the whole initializer: `const x = require("...")` followed by `;`, `,`, `}`, a line break or EOF.
        const bound = decl !== null && /^[ \t]*(?:[;,}\r\n]|$)/.test(code.slice(close + 1));
        if (decl !== null && bound) {
          bindings.push({ name: decl[1]!, declStart: Math.max(0, spec.stmtStart - 200) + decl.index, declEnd: close + 1 });
        } else {
          uncheckedAt("registry-require-unbound", at, `require of registry ${spec.lit.raw} is not bound to a plain identifier, so its use cannot be traced`);
        }
        break;
      }
      case "dynamic":
        uncheckedAt("registry-dynamic-import", at, `dynamic import of registry ${spec.lit.raw} — the loaded module's use is not traced by this gate`);
        break;
    }
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
      if (/(?<![\w$.])typeof\s+$/.test(code.slice(Math.max(0, i - 20), i))) continue; // a type query reads no content
      const afterName = code.slice(i + b.name.length, i + b.name.length + 20);
      if (/^\s*:(?!:)/.test(afterName) && isObjectKeyPosition(code, i)) continue; // `{ name: ... }` — a key, not the binding
      if (RESOLVER_CALL_RE.test(code.slice(Math.max(0, i - 80), i)) && /^\s*[,)]/.test(afterName)) continue;
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
    uncheckedAt("registry-path-string", lit.start, `string ${lit.raw} names the registry file; a load through it is not traced by this gate`);
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
