import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guards a real disclosure that was caught by review, not by any test: a
 * bare `import "@vespeneventures/governance"` — the root entry, the one a
 * consumer reaches for first — transitively loaded the full TypeScript
 * compiler. Not because the root's own code needs it, but because
 * `governance.ts` and `release/preflight.ts` each imported
 * `runFoundationCheck`/`computeBuildOrder` from the `./gates/index.js`
 * BARREL rather than from the specific files those functions live in — and
 * that barrel also re-exports `secret-gates.ts`, whose own top-level
 * `import ts from "typescript"` then rides along with everything else in
 * the barrel, regardless of which single export a caller actually wanted.
 *
 * Verified empirically once, by hand, at the time of the fix: `node_modules
 * /typescript` renamed aside, then `import("<dist>/index.js")` — it loaded
 * successfully. That proof doesn't survive a later refactor; THIS test is
 * what keeps it true going forward, by tracing the real SOURCE import graph
 * from `index.ts` (not `dist/`, so it runs on ordinary source with no build
 * step) and asserting it never reaches `gates/secret-gates.ts` or literal
 * `"typescript"`.
 *
 * A DFS, not a require-cache inspection or a bundler analysis: this
 * package's own module graph is small and entirely relative-specifier
 * `.js`-suffixed ESM imports (the NodeNext convention this repo's tsconfig
 * uses), which a small hand-rolled tracer handles correctly without a real
 * TS/ESM resolver as a test-only dependency — the same reasoning
 * `tokens/internal/parse-css.ts` gives for not pulling in a real CSS parser
 * for a narrow, well-understood input shape.
 */

const srcRoot = dirname(fileURLToPath(import.meta.url));

// `import type { X } from "./y.js"` is erased entirely at compile time —
// verified separately by reading the actual compiled dist output — so it
// carries no runtime import and must not be followed here. A plain
// `import { X } from "./y.js"` (even one that happens to only reference
// types after erasure, e.g. `import { type X } from "./y.js"`) DOES still
// execute the target module's top-level code at runtime, because TypeScript
// cannot know that from the specifier alone without type information this
// tracer deliberately doesn't have — so it is followed, which only makes
// this check stricter than reality, never looser. A stricter-than-real
// check can produce a false alarm; it can never miss a real one, which is
// the right direction for this specific worst-case-only guard.
// `(?:import|export)`, not just `import`: this package's own index.ts and
// gates/index.ts are barrels that RE-EXPORT with `export { X } from "./y.js"`
// — that form executes the target module's top-level code exactly the same
// as a plain `import` does. Missing it here would have made this tracer
// blind to both of this package's own real barrel files on the very first
// run — caught immediately by the "plausible number of files" sanity
// assertion below going to 1, which is exactly why that assertion exists
// rather than trusting the specific-file assertions alone.
//
// The `(?!type\s)` negative lookahead is doing real work, not decoration:
// an earlier version of this tracer matched EVERY `from "..."` clause first
// and then subtracted a SET of specifier strings seen on an `import type`
// line. `governance.ts` imports from `./gates/index.js` twice on adjacent
// lines — once as a real value import, once as `import type` — and because
// the subtraction worked by specifier STRING rather than by which specific
// statement was type-only, the real import got silently excluded too, just
// for sharing a target path with the type-only one. Matching "not-type"
// directly, per statement, at the regex itself avoids that class of bug
// entirely — proven by reverting the actual source fix this test guards and
// confirming this version (unlike the string-subtraction version) goes red.
const IMPORT_RE = /^\s*(?:import|export)\s+(?!type\s)(?:[\s\S]*?)\bfrom\s+["']([^"']+)["']/gm;

/**
 * Blanks out the CONTENTS of every string/template literal, preserving
 * length (so line/column positions — and therefore `^`/`$` line anchors in
 * the regexes below — stay correct) and the quote characters themselves.
 * Must run BEFORE comment-stripping: found by review, `//.*$` with no
 * string-literal awareness deletes the rest of a line — including a real
 * import on it — the moment `//` appears inside a same-line string ahead
 * of it (a URL in a doc-comment-adjacent constant, for instance). That is
 * an under-trace (a false negative), the opposite of this file's own
 * stated "stricter than reality, never looser" direction, so it is worth
 * closing even though no current file in this package happens to trigger
 * it today.
 *
 * Template-literal `${...}` interpolation is masked as a single opaque
 * unit at the top nesting level rather than recursively re-parsed — this
 * tracer only ever needs to find `from "specifier"` clauses, which never
 * appear inside an interpolation, so treating its contents as inert text
 * (rather than correctly as more code) loses nothing this file cares
 * about.
 */
function maskStringLiterals(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += quote;
      i++;
      let depth = 0; // ${...} nesting inside a template literal
      while (i < text.length) {
        const ch = text[i];
        if (ch === "\\" && i + 1 < text.length) {
          out += "  "; // blank the escape pair, preserve length
          i += 2;
          continue;
        }
        if (quote === "`" && ch === "$" && text[i + 1] === "{") {
          depth++;
          out += "  ";
          i += 2;
          continue;
        }
        if (depth > 0) {
          if (ch === "{") depth++;
          if (ch === "}") depth--;
          out += ch === "\n" ? "\n" : " "; // keep newlines so line numbers stay honest
          i++;
          continue;
        }
        if (ch === quote) {
          out += quote;
          i++;
          break;
        }
        out += ch === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function stripComments(text: string): string {
  const masked = maskStringLiterals(text);
  // Comment delimiters are found in the MASKED text (so one inside a
  // string is never mistaken for real), but the STRIPPING is applied by
  // position back onto the ORIGINAL text — comment stripping should still
  // remove the real characters, not the mask placeholders, and this keeps
  // both the masking and the stripping honest about what they each do.
  let result = "";
  let i = 0;
  while (i < masked.length) {
    if (masked[i] === "/" && masked[i + 1] === "*") {
      const end = masked.indexOf("*/", i + 2);
      const stop = end === -1 ? masked.length : end + 2;
      for (let j = i; j < stop; j++) if (text[j] === "\n") result += "\n";
      i = stop;
      continue;
    }
    if (masked[i] === "/" && masked[i + 1] === "/") {
      let end = masked.indexOf("\n", i);
      if (end === -1) end = masked.length;
      i = end;
      continue;
    }
    result += text[i];
    i++;
  }
  return result;
}

/**
 * Every relative import specifier a source file references at runtime
 * (type-only imports excluded), resolved from `.js` (the specifier, per
 * this repo's NodeNext convention) to the real `.ts` file on disk.
 */
function runtimeImportsOf(absPath: string): string[] {
  const raw = readFileSync(absPath, "utf8");
  const code = stripComments(raw);
  const specifiers: string[] = [];
  for (const m of code.matchAll(IMPORT_RE)) {
    const spec = m[1] as string;
    if (!spec.startsWith(".")) continue; // bare specifiers (node:*, @vespeneventures/*, "typescript") are leaves, not traced further
    specifiers.push(spec);
  }
  return specifiers.map((spec) => normalize(join(dirname(absPath), spec)).replace(/\.js$/, ".ts"));
}

/** Every relative-import bare specifier that ISN'T a `.`-relative path — i.e. what a file imports from outside itself — same real-import-only filter as `runtimeImportsOf`. */
function runtimeBareSpecifiersOf(absPath: string): string[] {
  const raw = readFileSync(absPath, "utf8");
  const code = stripComments(raw);
  const specifiers: string[] = [];
  for (const m of code.matchAll(IMPORT_RE)) {
    const spec = m[1] as string;
    if (spec.startsWith(".")) continue;
    specifiers.push(spec);
  }
  return specifiers;
}

function traceFromRoot(entryRelPath: string): { visited: Set<string>; bareSpecifiers: Set<string> } {
  const entry = join(srcRoot, entryRelPath);
  const visited = new Set<string>();
  const bareSpecifiers = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const path = queue.pop() as string;
    if (visited.has(path)) continue;
    visited.add(path);
    if (!existsSync(path)) continue; // a resolved specifier this tracer's simple .js->.ts rule doesn't cover (e.g. a directory index) — not a concern for this package's own flat-per-subpath layout, verified by the file count assertion below
    for (const next of runtimeImportsOf(path)) queue.push(next);
    for (const spec of runtimeBareSpecifiersOf(path)) bareSpecifiers.add(spec);
  }
  return { visited, bareSpecifiers };
}

describe("root entry (index.ts) never reaches typescript at runtime", () => {
  it("index.ts's own real import graph contains a plausible number of files (the tracer isn't silently finding nothing)", () => {
    const { visited } = traceFromRoot("index.ts");
    // A sanity floor, not an exact count: this package's root graph spans
    // types/lifecycle/scaffold/governance/preflight plus catalog and the
    // narrow gates files those pull in. If this ever drops near 1, the
    // tracer stopped following real imports and every assertion below
    // would be vacuously true.
    expect(visited.size).toBeGreaterThan(5);
  });

  it("never resolves gates/secret-gates.ts (the file that imports typescript)", () => {
    const { visited } = traceFromRoot("index.ts");
    const hit = [...visited].find((p) => p.endsWith(join("gates", "secret-gates.ts")));
    expect(hit).toBeUndefined();
  });

  it("never resolves the gates barrel (gates/index.ts) either — the root must import specific gate files directly, not the barrel that re-exports secret-gates alongside them", () => {
    const { visited } = traceFromRoot("index.ts");
    const hit = [...visited].find((p) => p.endsWith(join("gates", "index.ts")));
    expect(hit).toBeUndefined();
  });

  it("never has a bare `typescript` specifier anywhere in its real (non-type-only) import graph", () => {
    const { bareSpecifiers } = traceFromRoot("index.ts");
    expect(bareSpecifiers.has("typescript")).toBe(false);
  });

  it("the SAME check on gates/index.ts itself (the public subpath, not the root) — this one MUST still resolve secret-gates.ts and its typescript import, proving the tracer works and the split is precise rather than accidentally removing the functionality entirely", () => {
    const { visited, bareSpecifiers } = traceFromRoot(join("gates", "index.ts"));
    const hit = [...visited].find((p) => p.endsWith(join("gates", "secret-gates.ts")));
    expect(hit).toBeDefined();
    expect(bareSpecifiers.has("typescript")).toBe(true);
  });
});

describe("stripComments — string-literal awareness (the tracer's own robustness)", () => {
  // Found by adversarial review of this same tracer: `//.*$` with no
  // string-literal awareness deletes the rest of a line — including a
  // REAL import on it — once a same-line string contains "//" ahead of
  // that import (a URL is the obvious real-world case). This is a
  // regression test for that specific failure mode, using a synthetic
  // fixture rather than this package's own source, because the bug is
  // about the TRACER, not about anything this package currently contains.
  it("a same-line string containing // does not swallow a real import that follows it on the same line", () => {
    const code = 'const DOC_URL = "https://example.invalid/x"; import { runFoundationCheck } from "./gates/foundation.js";\n';
    const stripped = stripComments(code);
    expect(stripped).toContain('import { runFoundationCheck } from "./gates/foundation.js"');
  });

  it("a real // line comment is still stripped correctly (the fix doesn't just disable comment stripping)", () => {
    const code = "// import { runFoundationCheck } from \"./gates/foundation.js\";\nimport { evaluateLifecycleCoverage } from \"./lifecycle.js\";\n";
    const stripped = stripComments(code);
    expect(stripped).not.toContain("runFoundationCheck");
    expect(stripped).toContain('import { evaluateLifecycleCoverage } from "./lifecycle.js"');
  });

  it("a real /* block */ comment is still stripped correctly, including one that itself quotes an import statement in prose", () => {
    const code = '/* Deliberately NOT `import { X } from "./gates/index.js"` — see below. */\nimport { runFoundationCheck } from "./gates/foundation.js";\n';
    const stripped = stripComments(code);
    expect(stripped).not.toContain("gates/index.js");
    expect(stripped).toContain('import { runFoundationCheck } from "./gates/foundation.js"');
  });

  it("// inside a template literal is not mistaken for a comment either", () => {
    const code = "const DOC_URL = `https://example.invalid/x`; import { runFoundationCheck } from \"./gates/foundation.js\";\n";
    const stripped = stripComments(code);
    expect(stripped).toContain('import { runFoundationCheck } from "./gates/foundation.js"');
  });

  it("line numbers are preserved (masking/stripping fill with spaces/newlines, never delete lines) — the ^ line-anchor in IMPORT_RE depends on this", () => {
    const code = 'const X = "a // b";\nimport { runFoundationCheck } from "./gates/foundation.js";\n';
    const stripped = stripComments(code);
    const importLine = stripped.split("\n")[1];
    expect(importLine).toContain('import { runFoundationCheck } from "./gates/foundation.js"');
  });
});
