#!/usr/bin/env node
// check-readme-examples — does a README's fenced TypeScript example
// actually compile against the package's own shipped declarations?
//
//   node scripts/check-readme-examples.mjs <packageDir> [--json]
//
// Exit 0 = every eligible block compiled clean (skips are reported but do
// not fail the run), or every finding is an explicitly tracked waiver (see
// WAIVERS below — a waived run still says, in its own output, that it is
// not a clean one). Exit 1 = at least one real, unwaived finding, or a
// waiver entry that no longer matches anything (see WAIVERS). Exit 2 = the
// gate could not run at all (no tsc binary, this package's dist/ is
// missing while its README needs it, an unterminated code fence, or a
// missing package.json/README.md) — never a silent pass.
//
// WHY THIS GATE EXISTS (issue #908)
// -----------------------------------
// Nothing in this repository typechecks a README's own code examples.
// check-readme-parity.mjs verifies every export is documented (#311);
// check:typechecked-assertions covers `.check.ts` compile-time assertion
// markers. Neither reads a fenced code block. `@clossys/writer@0.3.8`
// shipped a headline README example that does not compile against the
// `.d.ts` in the same tarball:
//
//   readme-examples.ts(18,14): error TS2741: Property 'caseSensitive' is
//   missing in type '{ term: string; status: "forbidden"; reason: string; }'
//   but required in type 'GlossaryEntry'.
//
// A TypeScript consumer following the documentation gets a compile error on
// their first paste. This gate catches that class of defect mechanically:
// extract every fenced ` ```ts ` / ` ```tsx ` block, compile it against the
// package's own shipped declarations (its real `packages/<dir>` directory,
// resolved through the workspace symlink in `node_modules/`, so `import`
// resolution follows the package's own `package.json` "exports"/"types"
// fields exactly the way a real consumer's resolver would), and report the
// diagnostics.
//
// WHAT THIS GATE DOES NOT DO
// -----------------------------
// It does not fix `@clossys/writer`'s README. That correction is packed
// content — it moves the package's tree and needs its own version and
// qualification record (see docs/PUBLISHING.md) — and rides writer's next
// version bump rather than landing inside this repository-infrastructure
// change. See WAIVERS below for how this gate stays green in the meantime.
//
// THREE REAL CASES, MEASURED BY HAND WHILE BUILDING THIS
// -----------------------------------------------------------
//
// 1. MULTI-ROOT JSX FRAGMENTS. A ` ```tsx ` block that is illustrative JSX
//    with more than one top-level element (`@clossys/designer`'s README has
//    several — an `Icon` pair, a `Shell` sketch) produces `TS2657: JSX
//    expressions must have one parent element` the moment it is extracted
//    into its own file. That is an EXTRACTION ARTIFACT, not a defect in the
//    block — the README itself never claimed the snippet was one JSX
//    expression. When a block's diagnostics are ALL `TS2657`, this gate
//    transparently retries it wrapped in a `<>...</>` fragment before
//    deciding whether it is a real finding (see `AUTO_WRAP_RETRY` below).
//
// 2. DELIBERATELY INCOMPLETE SNIPPETS. A block that names a symbol defined
//    in the surrounding prose rather than in the block itself — e.g.
//    `@clossys/writer`'s README shows `assessApprovedCopyCoverageRate(input)`
//    where `input` is never declared, because the paragraph above is
//    describing the shape of `input`, not handing over a runnable script.
//    Compiling that block produces only "cannot find name" diagnostics
//    (`TS2304`/`TS2552`/`TS2503`). When EVERY diagnostic for a block falls
//    in that family, this gate reports it as SKIPPED, not a finding — see
//    SKIP_CODES below. A block whose diagnostics mix a name-resolution
//    error with something else is NOT skipped; that combination means the
//    block also has a real problem this gate should not hide.
//
// 3. moduleResolution/lib NOISE. `strict`, `module`/`moduleResolution`
//    "NodeNext", `skipLibCheck: false`, `lib: ["ES2022", "DOM"]`,
//    `jsx: "react-jsx"` — a fixed, explicit environment (COMPILER_OPTIONS
//    below), not a guess at whatever setting happens to make a given
//    package's own snippets compile. This is deliberately not each
//    package's own tsconfig.json: several packages set `moduleResolution:
//    "Bundler"`, which is right for THAT package's own build but would
//    silently accept README import forms real NodeNext consumers can't
//    resolve — exactly the class of noise-vs-signal problem #908 warns
//    against, from the opposite direction.
//
// REPORT THE SKIP COUNT EXPLICITLY (issue #907's own point, applied here)
// ---------------------------------------------------------------------------
// A first version that only covers syntactically-complete blocks and skips
// the rest is correct PROVIDED it says how many it skipped and why. Silently
// skipping and reporting a clean pass is the defect class #914 and #907
// exist to fight. Every run — pass, fail, or waived — prints the skip
// count and the reason breakdown, never just the pass/fail headline.
//
// WAIVERS (governance/known-readme-example-failures.json)
// -----------------------------------------------------------
// Same ratchet discipline scripts/check-contamination-classes.mjs already
// uses for governance/known-dangling-citations.json: a waiver names one
// package, one block index, and one diagnostic code, tracked under an
// issue. It is not an exemption — the file refuses to grow silently (a
// human adds an entry by hand, in a reviewed diff) and an entry that no
// longer matches anything this run found is ITSELF a new finding, so fixing
// the block and deleting its waiver entry are the same commit. A run with
// nonzero waived findings still exits 0 (so this gate can be wired into CI
// today without also fixing writer's README in this same change) but says,
// in its own printed output, that it is not a clean pass — see the PASS
// line below, worded the same way check-contamination-classes.mjs words it.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positional = argv.filter((a) => !a.startsWith("--"));
const pkgDirArg = positional[0];

function die(msg, code = 2) {
  console.error(`check-readme-examples: ${msg}`);
  process.exit(code);
}

if (!pkgDirArg) die("usage: check-readme-examples.mjs <packageDir> [--json]");

const pkgDir = resolve(pkgDirArg);
const packageDirName = basename(pkgDir);
const manifestPath = join(pkgDir, "package.json");
const readmePath = join(pkgDir, "README.md");

if (!existsSync(manifestPath)) die(`no package.json at ${manifestPath}`);
if (!existsSync(readmePath)) die(`no README.md at ${readmePath}`);

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  die(`package.json does not parse: ${error.message}`);
}
const packageName = manifest.name ?? pkgDirArg;

// ------------------------------------------------------------- extraction

// Scans line-by-line rather than with a single multiline regex so that an
// unterminated fence (malformed markdown) is caught explicitly instead of
// silently absorbing the rest of the file into one "block." Only an exact
// ` ```ts ` or ` ```tsx ` opening fence (nothing else on the line) starts a
// block — this deliberately does NOT match ` ```typescript `, ` ```jsx `,
// or a fence carrying extra text (e.g. a filename comment some READMEs use
// for `bash`/`json` blocks) — see #908's own scope: "extract fenced ```ts /
// ```tsx blocks", not every code fence that happens to hold TypeScript-ish
// text.
function extractBlocks(markdown) {
  const lines = markdown.split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const open = /^```(ts|tsx)\s*$/.exec(lines[i]);
    if (!open) {
      i++;
      continue;
    }
    const lang = open[1];
    const startLine = i + 2; // 1-indexed line of the first line of code
    let j = i + 1;
    const body = [];
    while (j < lines.length && lines[j] !== "```") {
      body.push(lines[j]);
      j++;
    }
    if (j >= lines.length) {
      return { blocks, unterminatedAt: i + 1 };
    }
    blocks.push({ index: blocks.length + 1, lang, startLine, endLine: j, body: body.join("\n") });
    i = j + 1;
  }
  return { blocks, unterminatedAt: null };
}

const readmeSrc = readFileSync(readmePath, "utf8");
const { blocks, unterminatedAt } = extractBlocks(readmeSrc);
if (unterminatedAt !== null) {
  die(`README.md has an unterminated \`\`\`ts/\`\`\`tsx fence starting at line ${unterminatedAt} — cannot extract blocks from malformed markdown`);
}

if (blocks.length === 0) {
  if (flags.has("--json")) {
    console.log(JSON.stringify({ package: packageName, packageDir: pkgDirArg, blockCount: 0, results: [], ok: true }, null, 2));
  } else {
    console.log(`check-readme-examples: ${packageName}`);
    console.log("  OK — 0 ts/tsx block(s) in this README.");
    console.log("\ncheck-readme-examples: OK.");
  }
  process.exit(0);
}

// ------------------------------------------------------------- environment

// Deliberately NOT this package's own tsconfig.json — see header comment
// "moduleResolution/lib NOISE" for why a fixed, explicit environment is the
// point, not each package's own build settings.
const COMPILER_OPTIONS = {
  target: "ES2022",
  module: "NodeNext",
  moduleResolution: "NodeNext",
  lib: ["ES2022", "DOM"],
  strict: true,
  skipLibCheck: false,
  esModuleInterop: true,
  forceConsistentCasingInFileNames: true,
  noEmit: true,
  jsx: "react-jsx",
  types: ["node"],
};

const tscBin = process.env.FOUNDRY_README_EXAMPLES_TSC_OVERRIDE
  ? resolve(process.env.FOUNDRY_README_EXAMPLES_TSC_OVERRIDE)
  : join(repoRoot, "node_modules", ".bin", "tsc");
if (!existsSync(tscBin)) {
  die(`no tsc binary at ${tscBin} — run npm install first; refusing to guess whether these examples would compile`);
}

// This package's own shipped declarations, the way a real consumer resolves
// them: not a hand-built path mapping, but `node_modules/<packageName>` —
// which, inside this npm workspace, is already a symlink to
// `packages/<dir>` — followed exactly as `import "<packageName>"` would
// follow it, through the package's own "exports"/"types" fields into
// `dist/`. Symlinking the WHOLE root `node_modules` into the throwaway
// compile directory (rather than copying, or hand-picking `react` etc.)
// means every other resolvable specifier a block might use (another
// first-party package, `react`, `@types/node`) resolves exactly the way it
// would for code living anywhere else in this repository — one symlink, no
// second resolution story to keep in sync with npm's own.
// blocks.length > 0 is already established above (the 0-block case exits
// early), so this package's shipped declarations are required from here on.
const distMarker = join(pkgDir, "dist");
if (!existsSync(distMarker)) {
  die(
    `${pkgDirArg} has ${blocks.length} ts/tsx README block(s) but no dist/ — this package has not been built. Run "npm run build --workspace=${pkgDirArg}" (or "npm run build") first; refusing to guess whether the shipped declarations would compile.`,
    2,
  );
}

const workDir = mkdtempSync(join(tmpdir(), "readme-examples-"));

function cleanup() {
  rmSync(workDir, { recursive: true, force: true });
}
process.on("exit", cleanup);

symlinkSync(join(repoRoot, "node_modules"), join(workDir, "node_modules"));
// "module"/"moduleResolution": "NodeNext" decides each file's module format
// (ESM vs. CommonJS) from the nearest package.json's "type" field. Every
// package here is ESM-only (see CONTRIBUTING.md, "Requires Node 20...
// Packages ship ESM only"), so this is not a guess — it's the one value
// that would ever be right.
writeFileSync(join(workDir, "package.json"), JSON.stringify({ type: "module" }, null, 2));
// `include: ["example.*"]` is a GLOB, not a literal filename — a literal
// name tsc can't find is itself a hard config error (TS6053), but a glob
// matching zero files is not, which matters because compileOne() below
// writes exactly one of "example.ts"/"example.tsx" per invocation and
// deletes it afterward.
const tsconfigPath = join(workDir, "tsconfig.json");
writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: COMPILER_OPTIONS, include: ["example.*"] }, null, 2));

// ------------------------------------------------------------------ compile

// ONE block per tsc invocation — deliberately not a single batched
// invocation covering every block in the package. Measured directly against
// `@clossys/writer`'s own README (9 blocks, one of which is a bare
// object-literal fragment that is a syntax error before wrapping): batching
// all 9 into one `tsc -p` run reports ONLY the syntax diagnostics from the
// broken file and SILENTLY DROPS every semantic diagnostic from every other
// file in that same run — including the exact TS2741 this gate exists to
// catch. Removing just the syntactically-broken file from the batch made
// the other files' real diagnostics reappear, confirming the cause: a
// syntax error anywhere in a `tsc -p` invocation suppresses semantic
// checking for the WHOLE program, not just the broken file. A batched
// design would therefore go silently blind on exactly the packages most
// likely to have prose-elided or fragment-shaped blocks (which are also the
// ones with real bugs in this repo's own history) — the opposite of what a
// "how many did you check" gate is for. One invocation per block costs
// process-spawn time, not correctness.
function compileOne(filename, content) {
  for (const f of ["example.ts", "example.tsx"]) {
    const p = join(workDir, f);
    if (existsSync(p)) rmSync(p);
  }
  writeFileSync(join(workDir, filename), content);
  let raw = "";
  let failed = false;
  try {
    execFileSync(tscBin, ["-p", tsconfigPath, "--pretty", "false"], {
      cwd: workDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    // tsc exits non-zero on ANY diagnostic — that is the expected, common
    // path here (most invocations are checking a block that will fail),
    // not necessarily a tool failure.
    failed = true;
    raw = (error.stdout ?? "") + (error.stderr ?? "");
  }
  const diags = [];
  for (const line of raw.split("\n")) {
    const m = DIAGNOSTIC_RE.exec(line.trim());
    if (m && basename(m[1]) === filename) {
      diags.push({ line: Number(m[2]), column: Number(m[3]), code: m[4], message: m[5] });
    }
  }
  // failed && diags.length === 0 means tsc exited non-zero but produced no
  // positional diagnostic pointing at THIS file — a config-level failure
  // (bad tsconfig, tsc crash, an unresolvable "types" entry), not a finding
  // about the block's content. Surfaced to the caller so it fails closed (2)
  // rather than reporting a false PASS for a block that was never actually
  // checked.
  return { diags, anomalous: failed && diags.length === 0, raw };
}

const DIAGNOSTIC_RE = /^(.*)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

// "Cannot find name 'X'" and its siblings — the shape a block produces when
// it references an identifier the surrounding PROSE defines rather than the
// block itself (see header comment, case 2). TS2552 is the "did you mean"
// variant of the same diagnostic; TS2503 is "Cannot find namespace"; TS18004
// is the same elided-identifier shape spelled as a destructuring shorthand
// property (`{ home }` where `home` is not in scope) rather than a bare
// reference -- measured on packages/builder/README.md:434, an
// `applyComposedInstallation(namedPlans, fs, { backupRoot })`-style snippet
// whose `home`/`backupRoot` are introduced several paragraphs earlier.
const SKIP_CODES = new Set(["TS2304", "TS2552", "TS2503", "TS18004"]);

// "Binding element 'X' implicitly has an 'any' type" (TS7031), "Parameter
// 'X' implicitly has an 'any' type" (TS7006), and "'X' is of type 'unknown'"
// (TS18046) -- NOT independently skip-eligible, because a genuinely untyped
// or unknown-typed value used on an otherwise well-defined expression is a
// real defect this gate should still catch. All three ARE the expected
// cascade of an elided outer reference, though:
// `sources.map(({ name, sourceRoot, manifest }) => ...)` produces one TS2304
// for `sources` (skip-eligible on its own) plus one TS7031 per destructured
// binding; `rows.map((row) => ...)` produces the same TS2304 plus one TS7006
// for the plain parameter; `Object.values(TOKENS).filter((def) =>
// def.brandable)` (TOKENS explicitly documented in the README's own prose as
// "the consumer's own tokens dependency — NOT imported by this package")
// produces TS2304 for TOKENS plus TS18046 on `def` inside the callback.
// Either way, TS cannot infer a callback's shape from an undefined
// collection. So none of these three codes ride along except when at least
// one genuine SKIP_CODES diagnostic is present in the same block (see
// partitionDiagnostics) -- never accepted in isolation.
const CASCADE_ONLY_SKIP_CODES = new Set(["TS7031", "TS7006", "TS18046"]);

const anomalies = [];
const pass1 = new Map(); // block.index -> diags[]
for (const block of blocks) {
  block.file = `example.${block.lang}`;
  const { diags, anomalous, raw } = compileOne(block.file, block.body + "\n");
  if (anomalous) anomalies.push({ block: block.index, raw });
  pass1.set(block.index, diags);
}

// "';' expected" / "Expression expected" — the shape produced when a block
// is a bare `{ ... }` object literal, valid as an EXPRESSION but not as a
// top-level statement (an object literal in statement position parses as a
// labelled block). A README illustrating "one entry looks like this" often
// reads exactly this way, continuing from prose above rather than standing
// alone — the same "deliberately incomplete" family as SKIP_CODES, just a
// syntax-level symptom instead of a semantic one.
const SYNTAX_CODES = new Set(["TS1005", "TS1109", "TS1128", "TS1131", "TS1136"]);
function looksLikeBareObjectLiteral(body) {
  const trimmed = body.trim();
  return trimmed.startsWith("{") && trimmed.endsWith("}");
}

// Splits a diagnostic list into the three families this gate recognizes:
// `fragment` (TS2657, the multi-root-JSX extraction artifact), `skip` (the
// SKIP_CODES "cannot find name" family — case 2), and `other` (everything
// else, i.e. a genuine, un-explainable problem). Real designer README
// content measured while building this gate combines the first two in one
// block routinely — the "Accessibility" `Icon` pair (packages/designer/
// README.md's own `decorative`/`label` example) is BOTH a multi-root
// fragment AND references `Icon`/`Clock` without importing them, because the
// import was already shown several paragraphs above. Gating the retry on
// "diagnostics are ALL TS2657" alone would treat that combination as an
// ordinary, unexplainable finding and force a waiver for content that is
// neither a JSX-extraction artifact nor an elided reference in isolation,
// but exactly both at once — so `other.length === 0` (not `diags.length ===
// fragment.length`) is the actual gate on whether a wrap is safe to try.
function partitionDiagnostics(diags) {
  const fragment = diags.filter((d) => d.code === "TS2657");
  const primarySkip = diags.filter((d) => SKIP_CODES.has(d.code));
  // Cascade codes only join `skip` when a genuine elided-identifier
  // diagnostic is also present -- otherwise a standalone TS7031 (an
  // untyped destructure with no elided cause at all) stays in `other` and
  // still reports as a real finding.
  const cascade = primarySkip.length > 0 ? diags.filter((d) => CASCADE_ONLY_SKIP_CODES.has(d.code)) : [];
  const skip = [...primarySkip, ...cascade];
  const other = diags.filter((d) => d.code !== "TS2657" && !skip.includes(d));
  return { fragment, skip, other };
}

// AUTO_WRAP_RETRY — cases 1 and the bare-object variant of case 2 in the
// header comment. Two independent wrap strategies, each gated on nothing
// UNEXPLAINABLE being present so a block is never silently "fixed" by a wrap
// that isn't obviously the right one:
//   - "fragment": a `.tsx` block with at least one `TS2657` and zero `other`
//     diagnostics (see partitionDiagnostics above — an accompanying
//     elided-name diagnostic does not disqualify it) — wrapped in
//     `<>...</>`. See the classify step below for what a wrap that still
//     leaves elided-name diagnostics behind is reported as.
//   - "paren": a block whose diagnostics are ALL syntax errors AND whose
//     body looks like a bare object literal — wrapped in `(...)`. A block
//     shaped like this was never given a type to check it against by the
//     README itself, so even a successful wrap only proves it's syntactically
//     well-formed, not that it satisfies any real interface. That is
//     reported as a SKIP, not a pass — this gate does not claim coverage it
//     does not have (see #907/#914 on the cost of overclaiming a check's
//     own scope).
const retryCandidates = blocks
  .map((b) => {
    const diags = pass1.get(b.index) ?? [];
    if (diags.length === 0) return null;
    const { fragment, other } = partitionDiagnostics(diags);
    if (b.lang === "tsx" && fragment.length > 0 && other.length === 0) return { block: b, kind: "fragment" };
    if (diags.every((d) => SYNTAX_CODES.has(d.code)) && looksLikeBareObjectLiteral(b.body)) return { block: b, kind: "paren" };
    return null;
  })
  .filter(Boolean);

const WRAP_TEMPLATES = {
  fragment: (body) => `<>\n${body}\n</>\n`,
  paren: (body) => `(\n${body}\n);\n`,
};

const retryOf = new Map(); // block.index -> { kind }
const pass2 = new Map(); // block.index -> diags[]
for (const { block, kind } of retryCandidates) {
  const ext = kind === "fragment" ? "tsx" : block.lang;
  const wrappedFile = `example.${ext}`;
  const { diags, anomalous, raw } = compileOne(wrappedFile, WRAP_TEMPLATES[kind](block.body));
  if (anomalous) anomalies.push({ block: block.index, raw, retry: kind });
  retryOf.set(block.index, { kind });
  pass2.set(block.index, diags);
}

// ------------------------------------------------------------------ classify

// Maps a diagnostic's line inside a (possibly wrapped) temp file back to the
// real line in README.md, so a finding points at the file a human would
// actually open. Both wrap templates add exactly one line above the block
// body (`<>` or `(`), so a wrapped diagnostic's local line is shifted by 1
// relative to the original block before the README offset is added.
function toReadmeLine(block, diagLine, wrapped) {
  const bodyLine = wrapped ? diagLine - 1 : diagLine;
  return block.startLine + bodyLine - 1;
}

const results = [];
for (const block of blocks) {
  const retry = retryOf.get(block.index);
  const diags = retry ? pass2.get(block.index) ?? [] : pass1.get(block.index) ?? [];
  const wrapped = Boolean(retry);

  if (diags.length === 0) {
    if (retry?.kind === "paren") {
      results.push({
        block: block.index,
        startLine: block.startLine,
        endLine: block.endLine,
        status: "skip",
        reason: "bare-fragment",
        detail: "a bare object-literal fragment, syntactically well-formed as an automatically-wrapped expression but never checked against any interface by the README itself (no declared type) — likely illustrative content continued from surrounding prose; skipped, not a finding",
      });
      continue;
    }
    results.push({
      block: block.index,
      startLine: block.startLine,
      endLine: block.endLine,
      status: "pass",
      wrapped,
      detail: wrapped ? "compiled clean after an automatic <>...</> wrap (multi-root JSX fragment — see #908)" : "compiled clean",
    });
    continue;
  }

  const { other: otherDiags } = partitionDiagnostics(diags);

  // otherDiags.length === 0 is the authoritative gate (see
  // partitionDiagnostics' own comment) -- it already accounts for
  // CASCADE_ONLY_SKIP_CODES riding along a genuine SKIP_CODES hit. A second
  // `diags.every((d) => SKIP_CODES.has(d.code))` check here would silently
  // re-exclude every cascade diagnostic (TS7031) from counting as skip-safe,
  // even after partitionDiagnostics already placed it in `skip` rather than
  // `other` -- exactly the kind of redundant, out-of-sync condition that lets
  // a fix in one place not take effect at the point that actually reports.
  if (otherDiags.length === 0) {
    // Reached two ways: an ordinary unwrapped block whose only diagnostics
    // are the elided-name family, OR a `fragment`-wrapped block where the
    // wrap removed every TS2657 and left only elided-name diagnostics
    // behind (the real designer `Icon` pair — see partitionDiagnostics()'s
    // own comment). Both are the same "deliberately incomplete" case, just
    // reached at a different pass.
    const names = [...new Set(diags.map((d) => /'([^']+)'/.exec(d.message)?.[1]).filter(Boolean))];
    results.push({
      block: block.index,
      startLine: block.startLine,
      endLine: block.endLine,
      status: "skip",
      reason: "elided-symbol",
      detail:
        `references identifier(s) not defined in this block (${names.join(", ") || "see diagnostics"}) — likely elided from the surrounding prose; skipped, not a finding` +
        (wrapped ? ` (compiled with an automatic ${retry.kind === "fragment" ? "<>...</>" : "(...)"} wrap first, to separate the extraction artifact from this)` : ""),
      diagnostics: diags,
    });
    continue;
  }

  results.push({
    block: block.index,
    startLine: block.startLine,
    endLine: block.endLine,
    status: "finding",
    wrapped,
    detail: wrapped ? `${diags.length} diagnostic(s) remain after an automatic ${retry.kind === "fragment" ? "<>...</>" : "(...)"} wrap` : `${diags.length} diagnostic(s)`,
    diagnostics: diags.map((d) => ({ ...d, readmeLine: toReadmeLine(block, d.line, wrapped) })),
  });
}

cleanup();
process.off("exit", cleanup);

if (anomalies.length > 0) {
  // A block that tsc failed to produce any positional diagnostic for, while
  // still exiting non-zero, was never actually checked — a config problem,
  // not a finding about that block's content. Fail closed (2) rather than
  // silently reporting it as a pass (see check-typechecked-assertions.mjs's
  // own FAIL-CLOSED section for the same discipline applied to a sibling
  // gate).
  console.error(`check-readme-examples: ${packageName} — ${anomalies.length} block(s) could not be evaluated (tsc failed with no diagnostic attributable to the block itself):`);
  for (const a of anomalies) {
    console.error(`  block ${a.block}${a.retry ? ` (${a.retry} retry)` : ""}:`);
    console.error(
      a.raw
        .split("\n")
        .filter(Boolean)
        .map((l) => `    ${l}`)
        .join("\n"),
    );
  }
  process.exit(2);
}

// ------------------------------------------------------------------- waivers
//
// See header comment "WAIVERS" for the discipline this mirrors
// (governance/known-dangling-citations.json / check-contamination-classes.mjs).
// `--waiver-file <path>` / `--no-waivers` mirror check-contamination-classes.mjs's
// `--allowlist` / `--no-allowlist` — mainly so this gate's own tests can point
// at a throwaway fixture waiver file instead of this checkout's real one.
const DEFAULT_WAIVER_PATH = join(repoRoot, "governance", "known-readme-example-failures.json");
const waiverFlagIndex = argv.indexOf("--waiver-file");
const WAIVER_PATH = waiverFlagIndex >= 0 ? resolve(argv[waiverFlagIndex + 1]) : DEFAULT_WAIVER_PATH;

function loadWaivers() {
  if (flags.has("--no-waivers")) return { issue: null, entries: [] };
  if (!existsSync(WAIVER_PATH)) return { issue: null, entries: [] };
  let doc;
  try {
    doc = JSON.parse(readFileSync(WAIVER_PATH, "utf8"));
  } catch (error) {
    die(`${WAIVER_PATH} does not parse: ${error.message}`);
  }
  const issue = doc?.issue;
  if (typeof issue !== "string" || !issue) {
    die(`${WAIVER_PATH} has no "issue" — a waiver with nothing tracking it is not a waiver`);
  }
  const entries = [];
  for (const [pkg, rows] of Object.entries(doc.packages ?? {})) {
    if (!Array.isArray(rows)) die(`${WAIVER_PATH}: packages["${pkg}"] must be an array`);
    for (const row of rows) {
      if (typeof row?.block !== "number" || typeof row?.code !== "string") {
        die(`${WAIVER_PATH}: packages["${pkg}"] has an entry with no numeric "block" and string "code"`);
      }
      entries.push({ package: pkg, block: row.block, code: row.code, reason: row.reason ?? "" });
    }
  }
  return { issue, entries };
}

const waiverDoc = loadWaivers();
const waiverEntriesForPackage = waiverDoc.entries.filter((e) => e.package === packageDirName);
const waiverUsed = new Set();
const waived = [];
const unwaivedFindings = [];

for (const result of results) {
  if (result.status !== "finding") continue;
  const codes = new Set(result.diagnostics.map((d) => d.code));
  const match = waiverEntriesForPackage.find((e) => e.block === result.block && codes.has(e.code) && !waiverUsed.has(e));
  if (match) {
    waiverUsed.add(match);
    waived.push({ ...result, waiver: match });
  } else {
    unwaivedFindings.push(result);
  }
}

const staleWaivers = waiverEntriesForPackage.filter((e) => !waiverUsed.has(e));

// -------------------------------------------------------------------- report

const skipped = results.filter((r) => r.status === "skip");
const passed = results.filter((r) => r.status === "pass");

if (flags.has("--json")) {
  console.log(
    JSON.stringify(
      {
        package: packageName,
        packageDir: pkgDirArg,
        blockCount: blocks.length,
        passed: passed.length,
        skipped: skipped.map((r) => ({ block: r.block, reason: r.reason, detail: r.detail })),
        findings: unwaivedFindings,
        waived: waived.map((w) => ({ block: w.block, code: w.waiver.code, issue: waiverDoc.issue })),
        staleWaivers: staleWaivers.map((e) => ({ block: e.block, code: e.code })),
        ok: unwaivedFindings.length === 0 && staleWaivers.length === 0,
      },
      null,
      2,
    ),
  );
  process.exit(unwaivedFindings.length === 0 && staleWaivers.length === 0 ? 0 : 1);
}

console.log(`check-readme-examples: ${packageName}`);
console.log(`  ${blocks.length} ts/tsx block(s) found — ${passed.length} compiled clean, ${skipped.length} skipped, ${unwaivedFindings.length + waived.length} finding(s) (${waived.length} waived, ${unwaivedFindings.length} not).`);

if (skipped.length > 0) {
  console.log(`\n  SKIPPED — ${skipped.length} block(s), not counted as findings:`);
  for (const s of skipped) console.log(`    block ${s.block} (README.md:${s.startLine}) — ${s.detail}`);
}

if (waived.length > 0) {
  console.log(`\n  KNOWN, WAIVED — ${waived.length} finding(s), tracked by ${waiverDoc.issue}:`);
  for (const w of waived) {
    console.log(`    block ${w.block} (README.md:${w.startLine}) — ${w.waiver.code}: ${w.waiver.reason || "(no reason recorded)"}`);
  }
}

if (staleWaivers.length > 0) {
  console.log(`\n  STALE WAIVER(S) — ${staleWaivers.length} entry(ies) in ${WAIVER_PATH} matched no finding this run:`);
  for (const e of staleWaivers) {
    console.log(`    package "${e.package}" block ${e.block} (${e.code}) — the block that produced this no longer does; delete this entry in the same commit as the fix.`);
  }
}

if (unwaivedFindings.length > 0) {
  console.log(`\n  FINDINGS — ${unwaivedFindings.length} block(s) do not compile:`);
  for (const f of unwaivedFindings) {
    console.log(`    block ${f.block} (README.md:${f.startLine}-${f.endLine})${f.wrapped ? " [auto-wrapped]" : ""}`);
    for (const d of f.diagnostics) console.log(`      README.md:${d.readmeLine} ${d.code}: ${d.message}`);
  }
}

console.log("");
if (unwaivedFindings.length === 0 && staleWaivers.length === 0) {
  console.log(
    waived.length > 0
      ? `check-readme-examples: PASS — no NEW finding(s) (${waived.length} known finding(s) waived above per ${WAIVER_PATH}, ${waiverDoc.issue}; a waived run is not a clean one).`
      : "check-readme-examples: PASS — no findings.",
  );
  process.exit(0);
}
console.log(
  `check-readme-examples: FAIL — ${unwaivedFindings.length} finding(s), ${staleWaivers.length} stale waiver(s).`,
);
process.exit(1);
