#!/usr/bin/env node
// check-unexamined-success — a static scan for the defect catalogued in
// issue #914: "a check reports success over ground it never examined."
//
//   node scripts/check-unexamined-success.mjs [--json] [<repoRoot>]
//
// Exit 0 = no instance of the shapes below was found in the scanned tree.
//          Exit 1 = at least one finding. Exit 2 = the file list could not be
//          established (see the ternary discipline note below).
//
// WHAT THIS LOOKS FOR
// -------------------
// Issue #914 names the mechanism, not fourteen unrelated bugs: a point where
// the code *knows* it could not evaluate something -- an invalid flag, an
// empty input set, a guard that never fired -- and that knowledge is
// discarded before a success verdict is formed. The issue names three
// recurring shapes. This gate implements two of them:
//
//   (a) FLAG NOT CONSULTED. A validity/ok/readable flag (or a
//       "could-not-read" / indeterminate marker) is computed as a local
//       variable and then either (a1) never read again anywhere in its own
//       block, or (a2) read by one sibling guard in that block but skipped by
//       an earlier sibling guard that exits the block regardless. (a2) is the
//       exact shape of the `observer.gradeFleetCoverage` bug this issue's
//       body cites: `declarationIsInvalid` was computed once, consulted on
//       the declared-absent branch, and never consulted on the
//       installed-package branch that `continue`s past it.
//
//   (c) VACUOUS SUCCESS OVER AN EMPTY COLLECTION. Two mechanical forms:
//       (c1) `X.every(...)` with no `X.length` guard anywhere in the file,
//       AND whose own statement itself forms a success verdict --
//       `Array.prototype.every` returns `true` on an empty array, which is
//       the textbook version of this defect (see the second condition's own
//       comment in the source for why it is there: an unqualified "no
//       `.length` guard" rule measured 32 false positives out of 33 findings
//       against this repository, because that idiom is also the correct,
//       ordinary shape of a JSON/array type guard). (c2) `if (X.length === 0)
//       { ... }` (or the `0 === X.length` / `!X.length` / `X.length < 1`
//       variants) whose consequent itself reads as a success verdict -- the
//       literal shape of the #338 `controller` zero-axis bug (`if
//       (axisResults.length === 0) { return gateSatisfied(1); }`).
//
// (b) EARLY EXIT SKIPS A FAIL-CLOSED BRANCH was IMPLEMENTED, MEASURED, AND
// REMOVED -- see the PR body ("shape (b): built, measured, dropped") for the
// full account. In short: "a `return`/`continue` positioned before a later
// fail-closed-looking sibling statement, whose own text never mentions that
// sibling's vocabulary" sounds narrow, but the single most common shape in
// ordinary TypeScript control flow -- "check case A, return; check case B,
// return; otherwise return the failure/fallback case" -- matches it exactly,
// because the early return's condition and the fallback's implicit condition
// are mutually exclusive branches of the SAME dispatch, not one skipping past
// examining the other. Measured directly against this repository: 15 for 15
// false positives, across discriminated-union returns, phase-gated adoption
// checks, and (the largest share) a per-item loop filter — `for (const x of
// xs) { if (fine(x)) continue; violations.push(...) }` — one level of `if`
// away from a literal `for (`/`while (` prefix, which is common enough
// (`skill-registry.ts`'s coverage fold, `token-gate.ts`, `contract.ts`,
// `currency-fold.ts`) that no cheap textual fix closed it without also
// losing the shape this detector existed to find. Shape (a)'s (a2) form is
// left standing as the practical proxy for this family: it requires a NAMED,
// vocabulary-matched flag rather than bare control flow, which is why it
// measured far better (see the PR body's table).
//
// WHAT THIS DOES NOT CLAIM TO CATCH
// ----------------------------------
// This is a syntactic pattern scan over a masked token stream, not a real
// parser and not a data-flow engine. It does not resolve imports, does not
// know which functions are "the gate's own verdict path" versus an unrelated
// helper, and does not understand a guard's condition well enough to know
// whether it actually subsumes a later check. It will miss instances that
// don't share these textual shapes, and it will flag some code that is fine
// on inspection -- see the PR body's measured precision/recall table before
// treating any one finding as proven. The #909 dead-CLI-entry-guard shape (a
// `realpathSync`-less `import.meta.url` comparison that silently never
// fires) is a DIFFERENT mechanism -- the fail-closed code is never
// unreachable *within* a function this scan can see, the guard just never
// evaluates true at the module's own entry point -- and this repository
// already has a dedicated runtime gate for exactly that shape:
// `scripts/check-bin-reachability.mjs`, which spawns the compiled bin through
// a real symlink and asserts non-empty output. This gate does not attempt to
// re-detect that mechanism statically.
//
// WHY REGEX/TOKEN-MASKING, NOT THE TYPESCRIPT COMPILER API
// -----------------------------------------------------------
// `typescript` is already a root devDependency (and a devDependency of most
// packages), so using its compiler API would not add a new dependency to the
// package graph. It was still rejected for this gate, for one concrete
// reason: `check:gates` (`scripts/test-gates.mjs` plus the `node --test`
// compound in package.json) runs inside ci.yml's `safety` job, which does
// `npm ci --ignore-scripts` only for the earlier push-tree/scope steps and
// never installs the full workspace tree before that job's `check:gates`
// step -- see that step's own surrounding comments in .github/workflows/
// ci.yml ("`check:gates` runs in the dependency-free `safety` job, which has
// no `npm ci` and no build"). A test file that `import`s `typescript` would
// throw `ERR_MODULE_NOT_FOUND` in that job. This file and its test suite
// therefore touch nothing outside node builtins, so the test suite can be
// wired into `check:gates` (see package.json) without changing that job's
// dependency-free contract. The gate itself is intentionally still not
// wired into `check:gates` or `npm run check` in the PR that introduces it --
// see that PR's body for the precision/recall measurement this decision
// rests on.
//
// TERNARY. satisfied 0 (scanned, nothing found) · violated 1 (scanned, found
// something) · indeterminate 2 (could not establish the file list at all --
// never reported as a clean pass, for the same reason issue #914 exists).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

// --------------------------------------------------------------- discovery

const SCAN_ROOTS = ["scripts", "packages"];
const IGNORED_DIR_NAMES = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);

function isTestPath(relPath) {
  const posix = relPath.split(sep).join("/");
  if (/\.test\.(mjs|ts|tsx)$/.test(posix)) return true;
  if (/(^|\/)(__tests__|test|tests|fixtures)\//.test(posix)) return true;
  return false;
}

/** Every `scripts/**\/*.mjs` and `packages/*\/src/**\/*.ts` file, tests excluded. */
export function discoverFiles(root) {
  const out = [];
  for (const scanRoot of SCAN_ROOTS) {
    const abs = join(root, scanRoot);
    let top;
    try {
      top = statSync(abs);
    } catch {
      continue;
    }
    if (!top.isDirectory()) continue;
    walk(abs, root, scanRoot, out);
  }
  return out.sort();
}

function walk(dir, root, scanRoot, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIR_NAMES.has(entry.name)) continue;
      walk(join(dir, entry.name), root, scanRoot, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const full = join(dir, entry.name);
    const rel = relative(root, full);
    const ext = extname(entry.name);
    if (scanRoot === "scripts") {
      if (ext !== ".mjs") continue;
    } else {
      // packages/*/src/**/*.ts
      if (ext !== ".ts") continue;
      const parts = rel.split(sep);
      // packages/<name>/src/...
      if (parts.length < 4 || parts[0] !== "packages" || parts[2] !== "src") continue;
    }
    if (isTestPath(rel)) continue;
    out.push(rel);
  }
}

// ------------------------------------------------------------ tokenization
//
// Replace the contents of strings, comments, and regex literals with spaces
// of the same length (newlines preserved), so brace/paren/bracket depth can
// be counted safely on the result and identifier searches never match text
// that only appears in a comment or a string.

const EXPR_CONTEXT_BEFORE_SLASH = /[=(,:;!&|?{}[+\-*%^~<>]\s*$|\breturn\s*$|\btypeof\s*$|\bcase\s*$/;

export function maskNonCode(src) {
  const n = src.length;
  const out = new Array(n);
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") { out[j] = " "; j++; }
      i = j;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      let j = i;
      out[j] = " "; out[j + 1] = " "; j += 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) { out[j] = src[j] === "\n" ? "\n" : " "; j++; }
      if (j < n) { out[j] = " "; out[j + 1] = " "; j += 2; }
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      let j = i;
      out[j] = " "; j++;
      while (j < n && src[j] !== quote && src[j] !== "\n") {
        if (src[j] === "\\") { out[j] = " "; j++; if (j < n) { out[j] = " "; j++; } continue; }
        out[j] = " "; j++;
      }
      if (j < n && src[j] === quote) { out[j] = " "; j++; }
      i = j;
      continue;
    }
    if (c === "`") {
      let j = i;
      out[j] = " "; j++;
      let depth = 0;
      while (j < n) {
        if (depth === 0 && src[j] === "\\") { out[j] = " "; j++; if (j < n) { out[j] = src[j] === "\n" ? "\n" : " "; j++; } continue; }
        if (depth === 0 && src[j] === "`") { out[j] = " "; j++; break; }
        if (depth === 0 && src[j] === "$" && src[j + 1] === "{") { out[j] = " "; out[j + 1] = " "; j += 2; depth = 1; continue; }
        if (depth > 0) {
          // Keep the code INSIDE `${...}` intact (so nested braces there stay
          // balanced for the caller's own depth counting), but the `{`/`}`
          // that open and close the interpolation itself are template
          // punctuation, not code, and must be masked like the backticks —
          // otherwise the closing `}` leaks into the masked text as a stray,
          // unmatched brace and corrupts every depth count after it.
          if (src[j] === "{") { depth++; out[j] = src[j]; j++; continue; }
          if (src[j] === "}") {
            depth--;
            out[j] = depth === 0 ? " " : src[j];
            j++;
            continue;
          }
          out[j] = src[j];
          j++;
          continue;
        }
        out[j] = src[j] === "\n" ? "\n" : " ";
        j++;
      }
      i = j;
      continue;
    }
    if (c === "/") {
      let k = i - 1;
      while (k >= 0 && (src[k] === " " || src[k] === "\t")) k--;
      const lookback = src.slice(Math.max(0, k - 6), k + 1);
      const looksLikeRegexStart = k < 0 || EXPR_CONTEXT_BEFORE_SLASH.test(lookback);
      if (looksLikeRegexStart) {
        let j = i + 1;
        let inClass = false;
        let closed = false;
        while (j < n && src[j] !== "\n") {
          if (src[j] === "\\") { j += 2; continue; }
          if (src[j] === "[") { inClass = true; j++; continue; }
          if (src[j] === "]") { inClass = false; j++; continue; }
          if (src[j] === "/" && !inClass) { closed = true; break; }
          j++;
        }
        if (closed) {
          let end = j + 1;
          while (end < n && /[a-z]/i.test(src[end])) end++;
          for (let m = i; m < end; m++) out[m] = " ";
          i = end;
          continue;
        }
      }
      out[i] = c;
      i++;
      continue;
    }
    out[i] = c;
    i++;
  }
  return out.join("");
}

/** Offsets of each line start, for fast offset -> 1-based line-number lookup. */
function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineAt(starts, offset) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

// A chunk's `.start` is the position right after the PREVIOUS chunk ended,
// so it typically lands on trailing whitespace/newlines from that boundary,
// not on the chunk's own first real character. Reporting a line straight
// from `chunk.start` can then point at a blank line above the actual guard.
// This finds the offset of the chunk's first non-whitespace character.
function firstNonWs(chunkText) {
  const m = /\S/.exec(chunkText);
  return m ? m.index : 0;
}

// --------------------------------------------------------------- splitting

/**
 * Split `text` into top-level statement chunks: anything at combined
 * brace/paren/bracket depth 0 is a boundary, either a `;` or the point a
 * `{`/`(`/`[` opened at depth 0 closes back to depth 0. This does not
 * understand `if`/`else`/`for` as compound constructs -- it just yields the
 * guard-with-its-block as one chunk and lets the caller pattern-match the
 * chunk's own text, which is sufficient for the shapes this gate looks for.
 */
export function splitTopLevelStatements(text) {
  const chunks = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{" || c === "(" || c === "[") {
      depth++;
    } else if (c === "}" || c === ")" || c === "]") {
      depth = Math.max(0, depth - 1);
      // Only a `}` closing back to depth 0 ends a statement (a block
      // statement/expression is complete once its braces balance). A `)` or
      // `]` returning to depth 0 does NOT end the statement — `if (cond)
      // return x;` and `if (cond) doThing(a, b);` still need everything up
      // to the terminating `;`, and splitting at the `)` would tear a
      // guard's condition away from its own consequent.
      if (depth === 0 && c === "}") {
        const seg = text.slice(start, i + 1);
        if (seg.trim().length > 0) chunks.push({ text: seg, start, end: i + 1 });
        start = i + 1;
      }
    } else if (c === ";" && depth === 0) {
      const seg = text.slice(start, i + 1);
      if (seg.trim().length > 0) chunks.push({ text: seg, start, end: i + 1 });
      start = i + 1;
    }
  }
  const tail = text.slice(start);
  if (tail.trim().length > 0) chunks.push({ text: tail, start, end: text.length });
  return chunks;
}

/**
 * Is the `{` that follows `before` (already trimmed of trailing whitespace)
 * a real code block, rather than an object literal/type/pattern sitting in a
 * value position? A value position always has one of `= ( [ ,` or `:` or the
 * `return` keyword directly before it (skipping only whitespace) — an object
 * literal argument, an assigned value, an array element, a property value, a
 * ternary branch, a returned object. Everything else that plausibly opens a
 * block is either a bare `{` (block statement), an `else`/`try`/`finally`/
 * `do`, something ending in `)` (`if`/`for`/`while`/`catch(...)`) or `>`/`]`
 * (an arrow's `=>`, or a TS array/generic return type), OR — the case that
 * matters here — a TypeScript return-type annotation, `function f(...):
 * ReturnType {` or `method(...): ReturnType {`, whose `before` ends in an
 * ordinary identifier character with no colon/paren/bracket directly
 * preceding the brace. That last case is why this is a blacklist (reject
 * value positions) rather than a whitelist of shapes ending in `)`/`>`: a
 * return type can be arbitrarily shaped (`Foo`, `Foo<Bar>`, `Foo | Bar`,
 * `readonly Foo[]`), and enumerating those shapes is a losing game, but
 * "does NOT sit in a value position" is a single check that already handles
 * every real value position seen in this codebase.
 */
function looksLikeCodeBlockOpener(before) {
  if (before === "") return true;
  if (/[=([,:]$/.test(before)) return false;
  if (/\breturn$/.test(before)) return false;
  if (/\b(else|try|finally|do)$/.test(before)) return true;
  if (/[)>\]]$/.test(before)) return true;
  return /[A-Za-z0-9_$]$/.test(before); // e.g. `): ReturnType {`
}

/**
 * Find the outermost `{...}` inside a chunk that is a real code block (an
 * `if`/`for`/`while`/`else`/`try`/`catch`/`finally`/`function`/arrow body),
 * not an object literal. Returns the inner content and its offset within
 * `chunk.text`, or null.
 */
export function codeBlockInChunk(chunkText) {
  let depth = 0;
  let braceStart = -1;
  for (let i = 0; i < chunkText.length; i++) {
    const c = chunkText[i];
    if (c === "{" || c === "(" || c === "[") {
      if (depth === 0 && c === "{") {
        const before = chunkText.slice(0, i).trimEnd();
        if (looksLikeCodeBlockOpener(before)) braceStart = i;
      }
      depth++;
    } else if (c === "}" || c === ")" || c === "]") {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && c === "}" && braceStart !== -1) {
        return { content: chunkText.slice(braceStart + 1, i), offset: braceStart + 1 };
      }
    }
  }
  return null;
}

// -------------------------------------------------------------- vocabulary

const FLAG_WORDS = new Set([
  "ok", "valid", "invalid", "readable", "unreadable", "malformed", "corrupt",
  "corrupted", "unclassified", "indeterminate", "unverified", "unreachable",
  "unparseable", "unparsable", "stale", "broken", "unresolved", "untrusted",
]);
const COULD_NOT_READ_RE = /could ?not ?read|cannot ?read|can ?not ?read|unable ?to ?read/;

function camelWords(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const COUNTER_WORDS = new Set(["count", "total", "num", "number", "size", "length", "sum", "tally"]);

function looksLikeFlagName(name) {
  // SCREAMING_SNAKE_CASE is this codebase's convention for a module-level
  // constant/enum-value label (`CITATION_UNREACHABLE = "unreachable"`), not a
  // per-invocation computed flag — measured false positive: `checkedType`
  // scanning matched `CITATION_UNREACHABLE` as if it were a freshly computed
  // "is this unreachable" boolean, when it is a fixed string tag referenced
  // (or not) by unrelated branches of a state machine, same as any other
  // enum member. A real flag name in this codebase is camelCase and so has
  // at least one lowercase letter; requiring one costs nothing else.
  if (name === name.toUpperCase()) return false;
  const words = camelWords(name);
  if (words.some((w) => COUNTER_WORDS.has(w))) return false; // a counter, not a boolean/state signal
  const lower = name.toLowerCase();
  if (COULD_NOT_READ_RE.test(lower)) return true;
  return words.some((w) => FLAG_WORDS.has(w));
}

// A bare `const validX = someExpr as SomeType;` is a TYPE-NARROWING CAST, not
// a computed validity check — the value has already been validated (usually
// by an earlier guard the cast's own comment points back to) and this is
// just telling the compiler that. Measured false positive: `resolve.ts`'s
// `validRegistry` is exactly this, and no later guard needs to "consult" it
// because it was never a boolean in the first place.
const BARE_TYPE_CAST_RE = /^[A-Za-z_$][\w$.[\]'"]*\s+as\s+[A-Za-z_$]/;

// Anchored to the START of a chunk (mod leading whitespace carried over from
// the previous chunk's boundary — see `splitTopLevelStatements`), not a
// global/`g` scan of the chunk's full text. A top-level chunk that IS a
// declaration statement has that declaration spanning its entire text, so
// matching at the start is sufficient and — this is the part that matters —
// it is what keeps a declaration nested deep inside a DIFFERENT chunk (for
// example a whole function declaration, whose chunk.text is its entire body)
// from being misread as a declaration of the OUTER block that function sits
// in. A `g`-scan over the full chunk text found exactly that: two unrelated
// functions in `keeper/contract.ts` each declare their own local `const
// indeterminate = ...`, and scanning `export function checkAttribution(...) {
// ... }` as one chunk found the inner declaration and attributed it to the
// FILE's own top level, which then "inherited" it into the next sibling
// function and paired it against that function's unrelated same-named local —
// a false positive spanning hundreds of lines and two functions that never
// nest. The recursive descent into nested blocks (below) is what actually
// finds a declaration in its true, nested scope; this regex only needs to
// see declarations that belong to the CURRENT block.
const DECL_AT_CHUNK_START_RE = /^\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/;

// Two deliberately DIFFERENT shapes for "satisfied", because this runs
// against RAW text (`detectorC` reads string-literal content directly — see
// its own comment on why `maskNonCode`'s blanking would hide the very
// vocabulary this needs) and a bare `\bsatisfied\b` is too loose there: this
// codebase's own explanatory error messages spell
// the word in quotes as prose ("verdict must be \"satisfied\" with a
// positive integer \"evaluated\"...", `run.ts`'s `customAxisResult`) and a
// naive match reads that documentation as a verdict. So a QUOTED "satisfied"
// only counts as a value when something value-shaped sits directly before
// it (`:`, `===`, `?`, or `return`) — a colon or comparison, not a sentence.
// An UNQUOTED "satisfied" only counts glued to other letters, i.e. genuinely
// part of an identifier (`gateSatisfied(...)`, the #338 zero-axis case this
// detector is calibrated against) — a bare unquoted word isn't idiomatic
// prose in this codebase's own comments/strings, so that side stays loose.
const SUCCESS_SHAPED_RE =
  /(:|===|return|\?)\s*["']satisfied["']|[A-Za-z]satisfied|satisfied[A-Za-z]|process\.exit\(\s*0\s*\)|\breturn\s+true\b|\bok\s*:\s*true\b|\bpass(ed)?\s*:\s*true\b/i;

const EXIT_STATEMENT_RE = /\breturn\b|\bcontinue\b|process\.exit\s*\(/;

// ------------------------------------------------------------- detector A

/** Shape (a): a flag is computed and then not consulted on some success path. */
function detectorA(masked, findings, relPath, starts) {
  // `inherited`: flags declared in an ANCESTOR block, so they are in scope for
  // this entire block (every top-level chunk here comes after that
  // declaration in source order). This is what lets the check reach the
  // `observer.gradeFleetCoverage` shape: `declarationIsInvalid` is declared
  // in the outer per-repository loop body, but the sibling guards that must
  // (and, on one path, must not) consult it live one level deeper, in the
  // inner per-package loop body.
  function scanBlock(text, baseOffset, inherited) {
    const chunks = splitTopLevelStatements(text);

    const localDecls = [];
    for (const chunk of chunks) {
      const m = DECL_AT_CHUNK_START_RE.exec(chunk.text);
      if (!m || !looksLikeFlagName(m[1])) continue;
      const declEnd = chunk.start + m.index + m[0].length;
      if (BARE_TYPE_CAST_RE.test(chunk.text.slice(m.index + m[0].length).trimStart())) continue;
      localDecls.push({ name: m[1], declEnd });
    }

    function reportIfSplit(name, exitChunks, declaredAt) {
      const withFlag = exitChunks.filter((c) => new RegExp(`\\b${name}\\b`).test(c.text));
      const withoutFlag = exitChunks.filter((c) => !new RegExp(`\\b${name}\\b`).test(c.text));
      if (withFlag.length === 0 || withoutFlag.length === 0) return;
      // ORDER matters, not just presence: a without-flag guard that comes
      // AFTER the flag is already checked is not a miss — by the time
      // execution reaches it, the flag-checking guard has already run and,
      // had the flag been bad, already exited. That is the single largest
      // false-positive source measured against this repository (see the PR
      // body): several independently-named booleans folded into one combined
      // guard (`if (!a || !b || !c) return null;`), immediately followed by
      // an unrelated LATER guard for a different concern (`if (!envelope)
      // return null;`) that has no need to re-mention any of them. Only a
      // without-flag guard that can be REACHED WITHOUT FIRST PASSING a
      // with-flag guard — i.e. it sits earlier in this block — reproduces
      // the `observer.gradeFleetCoverage` shape, where the installed-package
      // branch exits before the flag is ever consulted at all.
      const earliestWithFlagStart = Math.min(...withFlag.map((c) => c.start));
      const firstMiss = withoutFlag.find((c) => c.start < earliestWithFlagStart);
      if (!firstMiss) return;
      const consultedAt = lineAt(starts, baseOffset + withFlag[0].start + firstNonWs(withFlag[0].text));
      findings.push({
        rule: "flag-not-consulted-on-sibling-path",
        file: relPath,
        line: lineAt(starts, baseOffset + firstMiss.start + firstNonWs(firstMiss.text)),
        detail: `"${name}"${declaredAt === null ? "" : ` (declared at line ${declaredAt})`} is consulted by a later guard in this same block (line ${consultedAt}), but this earlier guard exits (return/continue) without checking it.`,
      });
    }

    // Local decls: (a1) never consulted again anywhere in this block, else
    // (a2) sibling-guard split, restricted to chunks after the declaration.
    for (const decl of localDecls) {
      const wordRe = new RegExp(`\\b${decl.name}\\b`);
      const after = chunks.filter((c) => c.start >= decl.declEnd);
      const restOfBlock = text.slice(decl.declEnd);
      if (!wordRe.test(restOfBlock)) {
        findings.push({
          rule: "flag-never-consulted",
          file: relPath,
          line: lineAt(starts, baseOffset + decl.declEnd),
          detail: `"${decl.name}" is computed here and never referenced again in its block — a validity/could-not-read signal that is write-only cannot gate anything.`,
        });
        continue;
      }
      const exitChunks = after.filter((c) => EXIT_STATEMENT_RE.test(c.text) && /^\s*if\b/.test(c.text));
      reportIfSplit(decl.name, exitChunks, lineAt(starts, baseOffset + decl.declEnd));
    }

    // Inherited decls: in scope for every chunk in this block.
    const exitChunksAll = chunks.filter((c) => EXIT_STATEMENT_RE.test(c.text) && /^\s*if\b/.test(c.text));
    for (const flag of inherited) {
      reportIfSplit(flag.name, exitChunksAll, flag.line);
    }

    // Recurse, passing down flags in scope by the time each nested block starts.
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const block = codeBlockInChunk(chunk.text);
      if (!block) continue;
      const scopedLocal = localDecls
        .filter((d) => d.declEnd <= chunk.start)
        .map((d) => ({ name: d.name, line: lineAt(starts, baseOffset + d.declEnd) }));
      scanBlock(block.content, baseOffset + chunk.start + block.offset, [...inherited, ...scopedLocal]);
    }
  }

  scanBlock(masked, 0, []);
}

// ------------------------------------------------------------- detector C

const LENGTH_ZERO_GUARD_RE =
  /if\s*\(\s*([A-Za-z_$][\w$.\[\]'"]*)\s*\.\s*length\s*===?\s*0\s*\)|if\s*\(\s*0\s*===?\s*([A-Za-z_$][\w$.\[\]'"]*)\s*\.\s*length\s*\)|if\s*\(\s*!\s*([A-Za-z_$][\w$.\[\]'"]*)\s*\.\s*length\s*\)|if\s*\(\s*([A-Za-z_$][\w$.\[\]'"]*)\s*\.\s*length\s*<\s*1\s*\)/g;

function detectorC(masked, rawText, findings, relPath, starts) {
  // (c1) `.every(` without a `.length` guard on the same receiver anywhere in
  // the file, AND whose statement reads as forming a success verdict.
  //
  // `Array.prototype.every` returning `true` on an empty array is correct,
  // idiomatic JavaScript for the overwhelming majority of real `.every(`
  // call sites: a type guard (`isStringArray`, `hasOwnKeys`, a prototype-
  // pollution shape check) where "every element of an empty set satisfies
  // the predicate" is the mathematically and semantically right answer, not
  // a symptom of unexamined ground. Measured directly against this
  // repository (see this gate's own PR body): requiring only "no `.length`
  // guard" produced 33 findings, of which 32 were exactly that idiom and
  // only 1 — a batch of published-package canary runs folding to `satisfied`
  // when the batch was empty — was the real defect. The distinguishing
  // signal in that one case was textual, not just structural: the call's own
  // statement itself contained the success vocabulary
  // (`verdict: runs.every(...) ? "satisfied" : "violated"`), where every
  // type-guard false positive did not. So this also requires the `.every(`
  // call's enclosing statement (approximated as its own source line plus up
  // to two more, to cover a wrapped ternary/return) to read as success-shaped.
  const everyRe = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]\n]*\])*)\s*\.\s*every\s*\(/g;
  let m;
  while ((m = everyRe.exec(masked)) !== null) {
    const receiver = m[1];
    const base = receiver.split(/[.[]/)[0];
    const guardRe = new RegExp(`\\b${base}\\b[\\w$.\\[\\]'"]*\\s*\\.\\s*length\\b`);
    if (guardRe.test(masked.slice(0, m.index)) || guardRe.test(masked.slice(m.index + m[0].length))) continue;
    const line = lineAt(starts, m.index);
    const windowStart = starts[line - 1];
    const windowEnd = starts[Math.min(starts.length - 1, line + 2)] ?? rawText.length;
    const statementWindow = rawText.slice(windowStart, windowEnd);
    if (!SUCCESS_SHAPED_RE.test(statementWindow)) continue;
    findings.push({
      rule: "every-call-with-no-length-guard",
      file: relPath,
      line,
      detail: `"${receiver}.every(...)" is vacuously true when "${receiver}" is empty, no "${base}.length" check appears anywhere in this file to rule that out, and this statement itself forms a success verdict.`,
    });
  }

  // (c2) `if (X.length === 0) { <success-shaped consequent> }`. Structural
  // bounds (where the consequent starts/ends) come from `masked`, same as
  // everywhere else, but the vocabulary test reads the RAW consequent:
  // `verdict: "satisfied"` is a string literal in this codebase's own
  // convention, and `maskNonCode` deliberately blanks string content so
  // structural parsing (brace depth, statement splitting) never trips over
  // what a string happens to contain — so the vocabulary check has to look
  // at the original text instead. `masked` and `rawText` are the same length
  // with the same newlines, so a masked position slices the matching raw
  // text directly.
  LENGTH_ZERO_GUARD_RE.lastIndex = 0;
  while ((m = LENGTH_ZERO_GUARD_RE.exec(masked)) !== null) {
    const receiver = m[1] || m[2] || m[3] || m[4];
    const guardEnd = m.index + m[0].length;
    const afterGuard = masked.slice(guardEnd);
    const block = codeBlockInChunk(afterGuard.slice(0, 4000)); // bounded lookahead for the consequent
    let consequent;
    if (block && block.offset === 0) {
      consequent = rawText.slice(guardEnd + block.offset, guardEnd + block.offset + block.content.length);
    } else {
      // braceless form: `if (...) return true;`
      const semi = afterGuard.indexOf(";");
      const len = semi === -1 ? 200 : semi + 1;
      consequent = rawText.slice(guardEnd, guardEnd + len);
    }
    if (SUCCESS_SHAPED_RE.test(consequent)) {
      findings.push({
        rule: "empty-collection-short-circuits-to-success",
        file: relPath,
        line: lineAt(starts, m.index),
        detail: `"${receiver}.length === 0" leads directly to a success-shaped result — a collection that was never examined is not evidence coverage was complete (see issue #338).`,
      });
    }
  }
}

// ----------------------------------------------------------------- driver

export function analyzeFile(relPath, text) {
  const masked = maskNonCode(text);
  const starts = lineStarts(text);
  const findings = [];
  detectorA(masked, findings, relPath, starts);
  detectorC(masked, text, findings, relPath, starts);
  return findings;
}

export function run({ root = process.cwd(), files = undefined, read = (path) => readFileSync(path, "utf8") } = {}) {
  let list;
  try {
    list = files ?? discoverFiles(root);
  } catch (error) {
    return { verdict: "indeterminate", findings: [], reason: `could not discover files: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (list.length === 0) {
    return { verdict: "indeterminate", findings: [], reason: "no scripts/**/*.mjs or packages/*/src/**/*.ts files were found — a scan of nothing is not a clean scan" };
  }

  const findings = [];
  let scanned = 0;
  for (const relPath of list) {
    let text;
    try {
      text = read(root ? join(root, relPath) : relPath);
    } catch {
      continue; // unreadable: not this gate's finding, same discipline as check-conflict-markers.mjs
    }
    scanned += 1;
    findings.push(...analyzeFile(relPath, text));
  }
  return { verdict: findings.length === 0 ? "satisfied" : "violated", findings, reason: null, scanned };
}

export const EXIT_CODES = Object.freeze({ satisfied: 0, violated: 1, indeterminate: 2 });

function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const rootArg = args.find((a) => !a.startsWith("--"));
  const root = rootArg ?? process.cwd();

  const result = run({ root });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(EXIT_CODES[result.verdict]);
  }

  for (const f of result.findings) {
    console.log(`  [${f.rule}] ${f.file}:${f.line} — ${f.detail}`);
  }
  if (result.verdict === "satisfied") {
    console.log(`\ncheck-unexamined-success: OK — ${result.scanned} file(s) scanned, no finding.`);
  } else if (result.verdict === "violated") {
    console.log(`\ncheck-unexamined-success: FAIL — ${result.findings.length} finding(s) across ${result.scanned} file(s) scanned.`);
    console.log("This is a heuristic scan (see this file's own header) — hand-verify each finding before fixing it.");
  } else {
    console.log(`\ncheck-unexamined-success: INDETERMINATE — ${result.reason}`);
  }
  process.exit(EXIT_CODES[result.verdict]);
}

if (process.argv[1] && process.argv[1].endsWith("check-unexamined-success.mjs")) main();
