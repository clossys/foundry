#!/usr/bin/env node
// check-typechecked-assertions — catch a type-level assertion written where
// nothing ever checks it.
//
//   node scripts/check-typechecked-assertions.mjs <packageDir> [--json]
//
// Exit 0 = every type-level assertion in this package lives in a file `tsc`
// actually compiles. Exit 1 = at least one does not (a real finding). Exit 2
// = this gate could not determine the answer and is refusing to guess.
//
// WHY THIS GATE EXISTS (issue #24)
// ---------------------------------
// Every package's tsconfig.json excludes test files from the real `tsc` run:
//
//   "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.test.tsx"]
//
// `npm run typecheck` / `npm run build` never compiles them. `vitest`
// TRANSPILES a test file (strips the types) rather than type-checking it. So
// a `@ts-expect-error`, `@ts-ignore`, `expectTypeOf(...)`, or `assertType(...)`
// written inside a `*.test.ts(x)` file asserts nothing: it can never fail,
// and — the more dangerous half — it never produces the "unused directive"
// error that would normally signal the guarded contract has changed
// underneath it. It reads as a real test and is not one.
//
// The fix this repo chose (see the pull request that closed #24 for the
// full reasoning) is the `*.check.ts(x)` convention: a compile-time-only
// assertion file, named so it falls OUTSIDE `**/*.test.ts(x)` and therefore
// INSIDE the real `tsc` run, with zero runtime footprint (never imported by
// any `index.ts`). `packages/ui/src/atoms/internal/icon-contract.check.tsx`
// is the precedent this pattern is drawn from. See CONTRIBUTING.md,
// "Type-level assertions live in `.check.ts(x)` files" for the convention
// itself.
//
// A convention that only lives in a CONTRIBUTING.md paragraph is exactly
// the shape of thing this repo does not trust (see docs/DECISIONS.md #4 —
// a rule nothing enforces is a rule that rots the moment someone forgets
// it). This gate is the enforcement: for every package, it asks `tsc`
// itself — not a reimplementation of tsconfig's glob semantics — which
// files it actually compiles, then scans every source file for an assertion
// marker and fails if any marker lives outside that real, compiled set.
//
// WHY "ASK TSC", NOT "REIMPLEMENT THE GLOB"
// -------------------------------------------
// `tsconfig.json`'s `include`/`exclude` fields are glob patterns, and glob
// semantics have real edge cases (`**`, negation order, `.d.ts` handling).
// Reimplementing that matching here would be a second, independently-
// maintained copy of logic `tsc` already has — the exact "mechanical
// restatement of data already known elsewhere" docs/DECISIONS.md #4
// describes and rejects. Instead this gate runs the package's own
// `tsc -p tsconfig.json --listFilesOnly`: `tsc`'s own answer to "which
// files are actually part of this compilation," using the package's real
// config, with no separate parser to drift out of sync with it.
//
// FAIL-CLOSED
// -----------
// "Could not determine whether a file is type-checked" is a FAILURE (exit
// 2), never a silent pass, in every one of these cases:
//   - packageDir, its tsconfig.json, or its src/ directory does not exist.
//   - the local `tsc` binary cannot be found.
//   - invoking `tsc --listFilesOnly` errors or exits non-zero (a broken
//     config is exactly the situation where trusting "no output" as "no
//     files, therefore no findings" would be silently wrong).
//   - `tsc` reports zero files under this package's own `src/` (impossible
//     for a real package; treated as a sign this gate broke, not as green).
// None of these share an exit code with a real pass (0) or a real finding
// (1) — see check-gates.mjs's own fail-closed cases for the same principle
// applied to the safety gates.
//
// WHAT COUNTS AS A "TYPE-LEVEL ASSERTION"
// ------------------------------------------
// `@ts-expect-error` and `@ts-ignore`, matched the same way `tsc` itself
// recognises them as directives (see `isDirective` below) rather than by a
// loose substring search — a loose search would also flag a comment that
// merely TALKS ABOUT the directive in prose (this repo has one:
// packages/ui/src/atoms/Icon.test.tsx explains, in English, why no
// directive lives there). `expectTypeOf(...)` and `assertType(...)` are
// matched as ordinary identifier calls. A `satisfies`-based contract check
// is NOT matched: at the time this gate was written, no such usage exists
// anywhere in a test file (every `satisfies` in the tree is an ordinary
// runtime object-literal-shape use), and a reliable "is this satisfies a
// type-only contract or a normal expression" heuristic does not fit in a
// gate this size without becoming a bug of its own — which is the same
// reason this repo does not carry machinery for a problem that has not
// actually occurred (CONTRIBUTING.md, "Conventions"). If a genuine
// `satisfies`-based type contract shows up in a `*.test.ts(x)` file later,
// extend the marker list below rather than adding a second gate.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positional = argv.filter((a) => !a.startsWith("--"));
const pkgDirArg = positional[0];

function die(msg, code = 2) {
  console.error(`check-typechecked-assertions: ${msg}`);
  process.exit(code);
}

if (!pkgDirArg) {
  die("usage: check-typechecked-assertions.mjs <packageDir> [--json]");
}

const pkgDir = resolve(pkgDirArg);
const tsconfigPath = join(pkgDir, "tsconfig.json");
const srcDir = join(pkgDir, "src");
const manifestPath = join(pkgDir, "package.json");

if (!existsSync(pkgDir)) die(`no such directory: ${pkgDir}`);
if (!existsSync(manifestPath)) die(`no package.json at ${manifestPath} — is this a package directory?`);
if (!existsSync(tsconfigPath)) die(`no tsconfig.json at ${tsconfigPath} — cannot determine what tsc compiles`);
if (!existsSync(srcDir)) die(`no src/ at ${srcDir}`);

let packageName;
try {
  packageName = JSON.parse(readFileSync(manifestPath, "utf8")).name ?? pkgDirArg;
} catch (error) {
  die(`package.json does not parse: ${error.message}`);
}

// ------------------------------------------------------- resolve the compiled set

const tscBin = join(repoRoot, "node_modules", ".bin", "tsc");
if (!existsSync(tscBin)) {
  die(`no tsc binary at ${tscBin} — run npm install first; refusing to guess what tsc would compile`);
}

let listing;
try {
  listing = execFileSync(tscBin, ["-p", tsconfigPath, "--listFilesOnly"], {
    cwd: pkgDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (error) {
  // --listFilesOnly resolves the project's file set before type-checking, so
  // a non-zero exit here means the CONFIG itself couldn't be resolved (a bad
  // tsconfig, an unresolvable "extends", a broken path) — not "there were
  // type errors." Either way this gate has no reliable file list to check
  // assertions against, so it fails closed rather than assuming an empty
  // (and therefore falsely clean) set.
  const detail = (error.stdout ?? "") + (error.stderr ?? "");
  die(`tsc could not resolve ${tsconfigPath}'s file list (exit ${error.status ?? "?"}) — failing closed rather than assuming a pass:\n${detail}`);
}

const srcPrefix = srcDir + sep;
const compiledRelPaths = new Set(
  listing
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith(srcPrefix))
    .map((l) => relative(pkgDir, l).split(sep).join("/")),
);

if (compiledRelPaths.size === 0) {
  die(`tsc -p ${tsconfigPath} --listFilesOnly reported zero files under ${srcDir} — that cannot be right for a real package, refusing to treat it as a clean pass`);
}

// ------------------------------------------------------------- walk real source

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

const sourceFiles = walk(srcDir);

// ------------------------------------------------------- assertion detection

// Mirrors TypeScript's own comment-directive recognition (typescript.js:
// commentDirectiveRegExSingleLine / commentDirectiveRegExMultiLine) closely
// enough to tell a real directive from prose that merely mentions one: the
// comment, once its own leading `//`, `/*`, `*`, or (for a JSX `{/* ... */}`
// comment) leading `{` are stripped, must ITSELF start with the directive.
// Icon.test.tsx:69's `` // `@ts-expect-error` written in this file... `` is
// deliberately NOT matched by this — it starts with a backtick, not the
// directive — the same reason tsc itself would never treat it as one.
const directiveRe = /^@(ts-expect-error|ts-ignore)\b/;

function directiveIn(line) {
  const trimmed = line.trim();
  let stripped = trimmed.replace(/^\{/, ""); // JSX comment container: {/* ... */}
  stripped = stripped.replace(/^(?:\/\/\/?|\/?\*+)\s*/, "");
  return directiveRe.test(stripped) ? stripped.match(directiveRe)[1] : null;
}

const callMarkerRe = /\b(expectTypeOf|assertType)\s*[(<]/;

const findings = [];
const protectedCount = { total: 0 };

for (const file of sourceFiles) {
  const rel = relative(pkgDir, file).split(sep).join("/");
  const isCompiled = compiledRelPaths.has(rel);
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const directive = directiveIn(line);
    const callMatch = line.match(callMarkerRe);
    const marker = directive ? `@${directive}` : callMatch ? `${callMatch[1]}(...)` : null;
    if (!marker) return;
    if (isCompiled) {
      protectedCount.total++;
    } else {
      findings.push({ file: rel, line: i + 1, marker, text: line.trim() });
    }
  });
}

// ------------------------------------------------------------------- report

if (flags.has("--json")) {
  console.log(
    JSON.stringify(
      {
        package: packageName,
        packageDir: pkgDirArg,
        compiledFileCount: compiledRelPaths.size,
        protectedAssertionCount: protectedCount.total,
        findings,
        ok: findings.length === 0,
      },
      null,
      2,
    ),
  );
  process.exit(findings.length === 0 ? 0 : 1);
}

console.log(`check-typechecked-assertions: ${packageName}`);
if (findings.length === 0) {
  console.log(
    `  OK — ${protectedCount.total} type-level assertion(s) found, all inside files tsc actually compiles (${compiledRelPaths.size} file(s) in this package's real build).`,
  );
} else {
  console.log(`\n  INERT type-level assertion(s) — these live in a file tsc never compiles for this package,`);
  console.log(`  so they can never fail and never report an "unused directive" regression either:\n`);
  for (const f of findings) {
    console.log(`    ${f.file}:${f.line}  ${f.marker}`);
    console.log(`      ${f.text}`);
  }
  console.log(
    `\n  Fix: move the assertion into a *.check.ts(x) file (see packages/ui/src/atoms/internal/icon-contract.check.tsx,`,
  );
  console.log(`  and CONTRIBUTING.md, "Type-level assertions live in .check.ts(x) files") so tsc actually checks it.`);
}

console.log(
  findings.length === 0
    ? `\ncheck-typechecked-assertions: OK.`
    : `\ncheck-typechecked-assertions: FAIL — ${findings.length} inert assertion(s).`,
);

process.exit(findings.length === 0 ? 0 : 1);
