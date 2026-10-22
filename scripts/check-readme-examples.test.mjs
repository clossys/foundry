import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Hermetic end-to-end coverage, spawning the real script exactly the way CI
// spawns it — same discipline check-release-readiness.test.mjs already uses.
//
// The gate under test shells out to a real `tsc`, but the `safety` CI job
// that runs `check:gates` never runs `npm ci` (every script under scripts/
// is zero-dependency Node specifically so those gates run with no install at
// all — see check-typechecked-assertions.mjs's own header for the same
// discipline). So every case here points the gate at
// FOUNDRY_README_EXAMPLES_TSC_OVERRIDE, a tiny stub `tsc` this suite writes,
// rather than the real compiler. The stub reads whichever of
// "example.ts"/"example.tsx" the gate wrote next to the `-p` tsconfig it was
// given, and prints back exactly the diagnostics a `// STUB_DIAGNOSTICS: [...]`
// (or, for the post-auto-wrap retry, `// STUB_DIAGNOSTICS_WRAPPED: [...]`)
// comment inside that file's own body asks for — so what is under test is
// this gate's OWN extraction, classification, retry, waiver, and reporting
// logic, pinned against a known, scripted answer, never a real compiler's
// judgement. That is exactly the writer/designer real-repo cases this gate
// was built against (see check-readme-examples.mjs's own header) — this
// suite is the hermetic complement, not a replacement for having run the
// real thing by hand (recorded in the pull request, not repeated here).

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "check-readme-examples.mjs");

let workRoot;
test.before(() => {
  workRoot = mkdtempSync(join(tmpdir(), "readme-examples-test-"));
});
test.after(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

let stubCounter = 0;

// Writes an executable stand-in for `tsc -p <tsconfig> --pretty false`. Real
// tsc's own `--pretty false` output is `file(line,col): error TSxxxx: msg`,
// one per line — this prints exactly that shape, scripted from the
// STUB_DIAGNOSTICS(_WRAPPED) marker comment embedded in the file being
// "compiled" (see module header comment above).
function makeStubTsc() {
  const stubPath = join(workRoot, `tsc-stub-${stubCounter++}.mjs`);
  const lines = [
    "#!/usr/bin/env node",
    "import { readFileSync, existsSync, appendFileSync, rmSync } from 'node:fs';",
    "import { dirname, join } from 'node:path';",
    "const args = process.argv.slice(2);",
    "const pIndex = args.indexOf('-p');",
    "const tsconfigPath = args[pIndex + 1];",
    "const dir = dirname(tsconfigPath);",
    "let file = null;",
    "for (const name of ['example.ts', 'example.tsx']) {",
    "  const candidate = join(dir, name);",
    "  if (existsSync(candidate)) { file = candidate; break; }",
    "}",
    "if (!file) process.exit(0);",
    "const content = readFileSync(file, 'utf8');",
    "const wrapped = /^(<>|\\()/.test(content.trimStart());",
    "function marker(key) {",
    "  const re = new RegExp('// ' + key + ': (.+)');",
    "  const m = re.exec(content);",
    "  return m ? JSON.parse(m[1]) : null;",
    "}",
    "// STUB_TRACE_FILE (env) records one 'start' and one 'end' line per run, in real time, so a test can",
    "// measure how many stub runs overlapped; STUB_DELAY_MS (marker) holds the run open so they can.",
    "if (process.env.STUB_TRACE_FILE) {",
    "  appendFileSync(process.env.STUB_TRACE_FILE, 'start\\n');",
    "  process.on('exit', () => appendFileSync(process.env.STUB_TRACE_FILE, 'end\\n'));",
    "}",
    "const delayMs = marker('STUB_DELAY_MS');",
    "if (delayMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);",
    "if (marker('STUB_CRASH')) process.kill(process.pid, 'SIGKILL');",
    "// STUB_SABOTAGE removes this run's own compile directory afterwards, so the NEXT block that",
    "// worker slot handles throws inside the harness (not a tsc diagnostic): an internal worker failure.",
    "if (marker('STUB_SABOTAGE')) process.on('exit', () => rmSync(dir, { recursive: true, force: true }));",
    "if (marker('STUB_ANOMALY') || (wrapped && marker('STUB_ANOMALY_WRAPPED'))) {",
    "  process.stderr.write('stub: fatal internal error (simulated)\\n');",
    "  process.exit(1);",
    "}",
    "const diags = wrapped ? (marker('STUB_DIAGNOSTICS_WRAPPED') ?? []) : (marker('STUB_DIAGNOSTICS') ?? []);",
    "for (const d of diags) {",
    "  process.stdout.write(`${file}(${d.line},${d.column}): error ${d.code}: ${d.message}\\n`);",
    "}",
    "process.exit(diags.length > 0 ? 1 : 0);",
    "",
  ];
  writeFileSync(stubPath, lines.join("\n"));
  chmodSync(stubPath, 0o755);
  return stubPath;
}

function diag(code, message, line = 1, column = 1) {
  return { line, column, code, message };
}

function markerLine(key, value) {
  return `// ${key}: ${JSON.stringify(value)}`;
}

function makeFixturePackage(name, { readme, hasDist = true } = {}) {
  const pkgDir = join(workRoot, `pkg-${name}-${stubCounter++}`);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: `@fixture/${name}`, version: "1.0.0" }));
  writeFileSync(join(pkgDir, "README.md"), readme);
  if (hasDist) mkdirSync(join(pkgDir, "dist"), { recursive: true });
  return pkgDir;
}

function run(args, { env } = {}) {
  try {
    const stdout = execFileSync("node", [scriptPath, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return { status: error.status ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

// ---------------------------------------------------------------- fixtures

test("usage error with no packageDir exits 2", () => {
  const result = run([]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: check-readme-examples/);
});

test("zero ts/tsx blocks in README: clean pass, no tsc or dist needed", () => {
  const pkgDir = makeFixturePackage("zero-blocks", {
    readme: "# zero\n\n```bash\necho hi\n```\n",
    hasDist: false,
  });
  // Deliberately no FOUNDRY_README_EXAMPLES_TSC_OVERRIDE at all — this must
  // never even look for a tsc binary when there is nothing to compile.
  const result = run([pkgDir]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /0 ts\/tsx block\(s\)/);
});

test("no tsc binary: exit 2, refuses to guess", () => {
  const pkgDir = makeFixturePackage("no-tsc", {
    readme: "```ts\nconst x = 1;\n```\n",
  });
  const result = run([pkgDir], { env: { FOUNDRY_README_EXAMPLES_TSC_OVERRIDE: join(workRoot, "does-not-exist") } });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no tsc binary/);
});

test("package not built (no dist/): exit 2", () => {
  const stub = makeStubTsc();
  const pkgDir = makeFixturePackage("no-dist", {
    readme: "```ts\nconst x = 1;\n```\n",
    hasDist: false,
  });
  const result = run([pkgDir], { env: { FOUNDRY_README_EXAMPLES_TSC_OVERRIDE: stub } });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /has not been built/);
});

test("unterminated code fence: exit 2, malformed markdown", () => {
  const stub = makeStubTsc();
  const pkgDir = makeFixturePackage("unterminated", {
    readme: "```ts\nconst x = 1;\n",
  });
  const result = run([pkgDir], { env: { FOUNDRY_README_EXAMPLES_TSC_OVERRIDE: stub } });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unterminated/);
});

test("clean block compiles with zero diagnostics: pass", () => {
  const stub = makeStubTsc();
  const readme = ["```ts", "import { x } from \"@fixture/clean\";", markerLine("STUB_DIAGNOSTICS", []), "```", ""].join("\n");
  const pkgDir = makeFixturePackage("clean", { readme });
  const result = run([pkgDir], { env: { FOUNDRY_README_EXAMPLES_TSC_OVERRIDE: stub } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /1 compiled clean/);
  assert.match(result.stdout, /PASS — no findings\./);
});

test("elided-symbol diagnostics (TS2304 family): skipped, not a finding", () => {
  const stub = makeStubTsc();
  const diags = [diag("TS2304", "Cannot find name 'input'.")];
  const readme = ["```ts", "assessRate(input);", markerLine("STUB_DIAGNOSTICS", diags), "```", ""].join("\n");
  const pkgDir = makeFixturePackage("elided", { readme });
  const result = run([pkgDir], { env: { FOUNDRY_README_EXAMPLES_TSC_OVERRIDE: stub } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /1 skipped/);
  assert.match(result.stdout, /elided from the surrounding prose/);
});

test("bare object-literal fragment: auto-wrap succeeds, reported as SKIP not PASS", () => {
  const stub = makeStubTsc();
  const raw = [diag("TS1109", "Expression expected.")];
  const readme = [
    "```ts",
    "{",
    `  ${markerLine("STUB_DIAGNOSTICS", raw)}`,
    `  ${markerLine("STUB_DIAGNOSTICS_WRAPPED", [])}`,
    "  term: \"x\",",
    "}",
    "```",
    "",
  ].join("\n");
  const pkgDir = makeFixturePackage("bare-object", { readme });
  const result = run([pkgDir], { env: { FOUNDRY_README_EXAMPLES_TSC_OVERRIDE: stub } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /1 skipped/);
  assert.match(result.stdout, /bare object-literal fragment/);
  // The whole point of the "paren" wrap kind: a syntactically-repaired bare
  // object is a SKIP (unverified against any interface), never claimed as a
  // compiled PASS — overclaiming coverage is exactly what #907/#914 warn
  // against.
  assert.doesNotMatch(result.stdout, /1 compiled clean/);
});

test("bare object-literal fragment that is genuinely malformed: still a finding after the wrap", () => {
  const stub = makeStubTsc();
  const raw = [diag("TS1109", "Expression expected.")];
  const wrapped = [diag("TS1005", "',' expected.", 2, 3)];
  const readme = [
    "```ts",
    "{",
    `  ${markerLine("STUB_DIAGNOSTICS", raw)}`,
    `  ${markerLine("STUB_DIAGNOSTICS_WRAPPED", wrapped)}`,
    "  term: \"x\" broken here",
    "}",
    "```",
    "",
  ].join("\n");
  const pkgDir = makeFixturePackage("bare-object-broken", { readme });
  const result = run([pkgDir], { env: { FOUNDRY_README_EXAMPLES_TSC_OVERRIDE: stub } });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FINDINGS/);
  assert.match(result.stdout, /auto-wrapped/);
});

test("multi-root JSX fragment (TS2657 only): auto-wrap succeeds, PASS", () => {
  const stub = makeStubTsc();
  const raw = [diag("TS2657", "JSX expressions must have one parent element.")];
  const readme = ["```tsx", "<A />", "<B />", markerLine("STUB_DIAGNOSTICS", raw), markerLine("STUB_DIAGNOSTICS_WRAPPED", []), "```", ""].join(
    "\n",
  );
  const pkgDir = makeFixturePackage("jsx-fragment", { readme });
  const result = run([pkgDir], { env: { FOUNDRY_README_EXAMPLES_TSC_OVERRIDE: stub } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /1 compiled clean/);
  assert.match(result.stdout, /PASS — no findings\./);
});

test("multi-root JSX fragment where the wrap does not fix it: still a finding", () => {
  const stub = makeStubTsc();
  const raw = [diag("TS2657", "JSX expressions must have one parent element.")];
  const wrapped = [diag("TS2322", "Type 'string' is not assignable to type 'number'.", 2, 5)];
  const readme = ["```tsx", "<A x={1} />", "<B x={2} />", markerLine("STUB_DIAGNOSTICS", raw), markerLine("STUB_DIAGNOSTICS_WRAPPED", wrapped), "```", ""].join(
    "\n",
  );
  const pkgDir = makeFixturePackage("jsx-fragment-broken", { readme });
  const result = run([pkgDir], { env: { FOUNDRY_README_EXAMPLES_TSC_OVERRIDE: stub } });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FINDINGS/);
  assert.match(result.stdout, /auto-wrapped/);
});

test("multi-root JSX fragment that ALSO references an elided name: auto-wrap runs, then SKIPPED (not a finding) — the real designer Icon-pair shape", () => {
  const stub = makeStubTsc();
  // Raw: both the extraction artifact (TS2657) AND an elided reference
  // (TS2304) are present at once — packages/designer/README.md's own
  // "Accessibility" Icon pair is exactly this shape (multi-root JSX,
  // referencing `Icon`/`Clock` imported many paragraphs earlier).
  const raw = [diag("TS2657", "JSX expressions must have one parent element."), diag("TS2304", "Cannot find name 'Icon'.")];
  // After the auto-wrap removes the TS2657, only the elided-name diagnostic
  // remains — this must be reported as a SKIP, not a PASS (it was never
  // actually verified) and not a FINDING (the missing name is not this
  // block's own defect).
  const wrapped = [diag("TS2304", "Cannot find name 'Icon'.")];
  const readme = ["```tsx", "<Icon />", "<Icon label=\"x\" />", markerLine("STUB_DIAGNOSTICS", raw), markerLine("STUB_DIAGNOSTICS_WRAPPED", wrapped), "```", ""].join(
    "\n",
  );
  const pkgDir = makeFixturePackage("jsx-fragment-plus-elided", { readme });
  const result = run([pkgDir], { env: { FOUNDRY_README_EXAMPLES_TSC_OVERRIDE: stub } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /1 skipped/);
  assert.match(result.stdout, /elided from the surrounding prose/);
  assert.doesNotMatch(result.stdout, /FINDINGS/);
});

test("real, unwaived finding: exit 1", () => {
  const stub = makeStubTsc();
  const diags = [diag("TS2741", "Property 'caseSensitive' is missing in type '...' but required in type 'GlossaryEntry'.", 3, 5)];
  const readme = ["```ts", "const g = { term: 'x', status: 'forbidden' };", markerLine("STUB_DIAGNOSTICS", diags), "```", ""].join("\n");
  const pkgDir = makeFixturePackage("finding", { readme });
  const result = run([pkgDir], { env: { FOUNDRY_README_EXAMPLES_TSC_OVERRIDE: stub } });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL — 1 finding\(s\)/);
  assert.match(result.stdout, /TS2741/);
});

test("a finding matching a waiver entry: exits 0 but says the run is not clean", () => {
  const stub = makeStubTsc();
  const diags = [diag("TS2741", "Property 'caseSensitive' is missing.", 3, 5)];
  const readme = ["```ts", "const g = { term: 'x', status: 'forbidden' };", markerLine("STUB_DIAGNOSTICS", diags), "```", ""].join("\n");
  const pkgDir = makeFixturePackage("waived", { readme });
  const packageDirName = pkgDir.split("/").pop();
  const waiverPath = join(workRoot, `waiver-${stubCounter++}.json`);
  writeFileSync(
    waiverPath,
    JSON.stringify({
      issue: "#908",
      packages: { [packageDirName]: [{ block: 1, code: "TS2741", reason: "test fixture" }] },
    }),
  );
  const result = run([pkgDir, "--waiver-file", waiverPath], { env: { FOUNDRY_README_EXAMPLES_TSC_OVERRIDE: stub } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /KNOWN, WAIVED/);
  assert.match(result.stdout, /not a clean one/);
});

test("a stale waiver entry (names a block/code that produced no finding): exit 1", () => {
  const stub = makeStubTsc();
  const readme = ["```ts", "const x = 1;", markerLine("STUB_DIAGNOSTICS", []), "```", ""].join("\n");
  const pkgDir = makeFixturePackage("stale-waiver", { readme });
  const packageDirName = pkgDir.split("/").pop();
  const waiverPath = join(workRoot, `waiver-${stubCounter++}.json`);
  writeFileSync(
    waiverPath,
    JSON.stringify({
      issue: "#908",
      packages: { [packageDirName]: [{ block: 1, code: "TS2741", reason: "no longer matches anything" }] },
    }),
  );
  const result = run([pkgDir, "--waiver-file", waiverPath], { env: { FOUNDRY_README_EXAMPLES_TSC_OVERRIDE: stub } });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /STALE WAIVER/);
});

test("--no-waivers ignores an on-disk waiver file that would otherwise suppress a finding", () => {
  const stub = makeStubTsc();
  const diags = [diag("TS2741", "Property 'caseSensitive' is missing.", 3, 5)];
  const readme = ["```ts", "const g = { term: 'x', status: 'forbidden' };", markerLine("STUB_DIAGNOSTICS", diags), "```", ""].join("\n");
  const pkgDir = makeFixturePackage("no-waivers", { readme });
  const packageDirName = pkgDir.split("/").pop();
  const waiverPath = join(workRoot, `waiver-${stubCounter++}.json`);
  writeFileSync(
    waiverPath,
    JSON.stringify({ issue: "#908", packages: { [packageDirName]: [{ block: 1, code: "TS2741", reason: "test fixture" }] } }),
  );
  const result = run([pkgDir, "--waiver-file", waiverPath, "--no-waivers"], { env: { FOUNDRY_README_EXAMPLES_TSC_OVERRIDE: stub } });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL — 1 finding\(s\)/);
});

test("a block tsc could not evaluate (anomaly): exit 2, fails closed", () => {
  const stub = makeStubTsc();
  const readme = ["```ts", "const x = 1;", markerLine("STUB_ANOMALY", true), "```", ""].join("\n");
  const pkgDir = makeFixturePackage("anomaly", { readme });
  const result = run([pkgDir], { env: { FOUNDRY_README_EXAMPLES_TSC_OVERRIDE: stub } });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /could not be evaluated/);
});

test("mixed pass/skip/finding across several blocks: skip count is reported explicitly", () => {
  const stub = makeStubTsc();
  const readme = [
    "```ts",
    "import { a } from \"x\";",
    markerLine("STUB_DIAGNOSTICS", []),
    "```",
    "",
    "```ts",
    "use(input);",
    markerLine("STUB_DIAGNOSTICS", [diag("TS2304", "Cannot find name 'input'.")]),
    "```",
    "",
    "```ts",
    "const g = { bad: 1 };",
    markerLine("STUB_DIAGNOSTICS", [diag("TS2741", "missing field", 2, 3)]),
    "```",
    "",
  ].join("\n");
  const pkgDir = makeFixturePackage("mixed", { readme });
  const result = run([pkgDir], { env: { FOUNDRY_README_EXAMPLES_TSC_OVERRIDE: stub } });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /3 ts\/tsx block\(s\) found — 1 compiled clean, 1 skipped, 1 finding\(s\)/);
});

test("--json reports the same shape the text output describes", () => {
  const stub = makeStubTsc();
  const diags = [diag("TS2741", "missing field", 2, 3)];
  const readme = ["```ts", "const g = { bad: 1 };", markerLine("STUB_DIAGNOSTICS", diags), "```", ""].join("\n");
  const pkgDir = makeFixturePackage("json-shape", { readme });
  const result = run([pkgDir, "--json"], { env: { FOUNDRY_README_EXAMPLES_TSC_OVERRIDE: stub } });
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.blockCount, 1);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0].diagnostics[0].code, "TS2741");
});

test("ONLY the ```ts and ```tsx fences are extracted — not ```typescript, ```jsx, or ```bash", () => {
  const stub = makeStubTsc();
  const readme = [
    "```typescript",
    "this should never be extracted at all;",
    "```",
    "",
    "```jsx",
    "<ThisShouldNeverBeExtractedEither />",
    "```",
    "",
    "```bash",
    "echo not-typescript",
    "```",
    "",
  ].join("\n");
  const pkgDir = makeFixturePackage("wrong-fence-lang", { readme, hasDist: false });
  const result = run([pkgDir], { env: { FOUNDRY_README_EXAMPLES_TSC_OVERRIDE: stub } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /0 ts\/tsx block\(s\)/);
});

test("TS18004 (shorthand property, elided): skipped, not a finding", () => {
  // Measured on packages/builder/README.md:434 -- `{ backupRoot }` where
  // `backupRoot` is introduced several paragraphs earlier, the same
  // "deliberately incomplete" shape as a bare TS2304 reference, just spelled
  // as a destructuring shorthand property instead of a plain identifier.
  const stub = makeStubTsc();
  const diags = [diag("TS18004", "No value exists in scope for the shorthand property 'backupRoot'. Either declare one or provide an initializer.")];
  const readme = ["```ts", "applyComposedInstallation(namedPlans, fs, { backupRoot });", markerLine("STUB_DIAGNOSTICS", diags), "```", ""].join("\n");
  const pkgDir = makeFixturePackage("shorthand-elided", { readme });
  const result = run([pkgDir], { env: { FOUNDRY_README_EXAMPLES_TSC_OVERRIDE: stub } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /1 skipped/);
  assert.match(result.stdout, /elided from the surrounding prose/);
});

test("TS7031 riding with a genuine elided reference: whole block skipped", () => {
  // packages/builder/README.md:422-446's real shape: `sources.map(({ name,
  // sourceRoot, manifest }) => ...)` where `sources` itself is undefined
  // (TS2304), so TS cannot infer the callback's destructured parameter
  // types (TS7031 per binding) -- a cascade of the one elided reference,
  // not three independent untyped-parameter defects.
  const stub = makeStubTsc();
  const diags = [
    diag("TS2304", "Cannot find name 'sources'."),
    diag("TS7031", "Binding element 'name' implicitly has an 'any' type."),
    diag("TS7031", "Binding element 'sourceRoot' implicitly has an 'any' type."),
    diag("TS7031", "Binding element 'manifest' implicitly has an 'any' type."),
  ];
  const readme = [
    "```ts",
    "const namedPlans = sources.map(({ name, sourceRoot, manifest }) => ({ source: name }));",
    markerLine("STUB_DIAGNOSTICS", diags),
    "```",
    "",
  ].join("\n");
  const pkgDir = makeFixturePackage("cascade-elided", { readme });
  const result = run([pkgDir], { env: { FOUNDRY_README_EXAMPLES_TSC_OVERRIDE: stub } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /1 skipped/);
  assert.match(result.stdout, /elided from the surrounding prose/);
});

test("TS7031 with NO accompanying elided reference: still a real finding", () => {
  // The safety property CASCADE_ONLY_SKIP_CODES exists for: an untyped
  // destructuring parameter on an otherwise well-defined value is a genuine
  // defect, and must never be silently absorbed just because TS7031 also
  // happens to be the code a cascade produces. No TS2304/2552/2503/18004
  // anywhere in this block, so it must still report as a finding.
  const stub = makeStubTsc();
  const diags = [diag("TS7031", "Binding element 'x' implicitly has an 'any' type.")];
  const readme = ["```ts", "const f = ({ x }) => x;", markerLine("STUB_DIAGNOSTICS", diags), "```", ""].join("\n");
  const pkgDir = makeFixturePackage("standalone-ts7031", { readme });
  const result = run([pkgDir], { env: { FOUNDRY_README_EXAMPLES_TSC_OVERRIDE: stub } });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /1 finding/);
  assert.match(result.stdout, /TS7031/);
});

test("TS7006 riding with a genuine elided reference: whole block skipped", () => {
  // packages/designer/README.md's real shape: `rows.map((row) => ...)`
  // where `rows` itself is undefined (TS2304), so TS cannot infer the
  // callback's plain parameter type (TS7006) -- the same cascade as TS7031,
  // just for an ordinary parameter instead of a destructured binding.
  const stub = makeStubTsc();
  const diags = [
    diag("TS2304", "Cannot find name 'rows'."),
    diag("TS7006", "Parameter 'row' implicitly has an 'any' type."),
  ];
  const readme = ["```ts", "const cells = rows.map((row) => row.id);", markerLine("STUB_DIAGNOSTICS", diags), "```", ""].join("\n");
  const pkgDir = makeFixturePackage("cascade-ts7006", { readme });
  const result = run([pkgDir], { env: { FOUNDRY_README_EXAMPLES_TSC_OVERRIDE: stub } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /1 skipped/);
  assert.match(result.stdout, /elided from the surrounding prose/);
});

test("TS7006 with NO accompanying elided reference: still a real finding", () => {
  // Same safety property as TS7031's standalone case: an untyped plain
  // parameter on an otherwise well-defined value is a genuine defect and
  // must never be silently absorbed just because TS7006 also happens to be
  // the code a cascade produces. No TS2304/2552/2503/18004 anywhere in this
  // block, so it must still report as a finding.
  const stub = makeStubTsc();
  const diags = [diag("TS7006", "Parameter 'x' implicitly has an 'any' type.")];
  const readme = ["```ts", "const f = (x) => x;", markerLine("STUB_DIAGNOSTICS", diags), "```", ""].join("\n");
  const pkgDir = makeFixturePackage("standalone-ts7006", { readme });
  const result = run([pkgDir], { env: { FOUNDRY_README_EXAMPLES_TSC_OVERRIDE: stub } });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /1 finding/);
  assert.match(result.stdout, /TS7006/);
});

test("TS18046 riding with a genuine elided reference: whole block skipped", () => {
  // packages/strategist/README.md:638-649's real shape: `TOKENS` is
  // explicitly documented in the README's own prose as "the consumer's own
  // tokens dependency — NOT imported by this package," so `Object.values
  // (TOKENS).filter((def) => def.brandable)` produces TS2304 for TOKENS
  // plus TS18046 ("'def' is of type 'unknown'") wherever the callback
  // touches `def` -- a cascade of the one elided reference.
  const stub = makeStubTsc();
  const diags = [
    diag("TS2304", "Cannot find name 'TOKENS'."),
    diag("TS18046", "'def' is of type 'unknown'."),
    diag("TS18046", "'def' is of type 'unknown'."),
  ];
  const readme = [
    "```ts",
    "const brandableSlots = Object.values(TOKENS).filter((def) => def.brandable).map((def) => def.property);",
    markerLine("STUB_DIAGNOSTICS", diags),
    "```",
    "",
  ].join("\n");
  const pkgDir = makeFixturePackage("cascade-unknown", { readme });
  const result = run([pkgDir], { env: { FOUNDRY_README_EXAMPLES_TSC_OVERRIDE: stub } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /1 skipped/);
  assert.match(result.stdout, /elided from the surrounding prose/);
});

test("TS18046 with NO accompanying elided reference: still a real finding", () => {
  const stub = makeStubTsc();
  const diags = [diag("TS18046", "'e' is of type 'unknown'.")];
  const readme = ["```ts", "try { risky(); } catch (e) { console.log(e.message); }", markerLine("STUB_DIAGNOSTICS", diags), "```", ""].join("\n");
  const pkgDir = makeFixturePackage("standalone-ts18046", { readme });
  const result = run([pkgDir], { env: { FOUNDRY_README_EXAMPLES_TSC_OVERRIDE: stub } });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /1 finding/);
  assert.match(result.stdout, /TS18046/);
});

// ------------------------------------------------- parallel worker pool (#2417)

const JOBS_ENV = "FOUNDRY_README_EXAMPLES_JOBS";

function stubEnv(stub, jobs, extra = {}) {
  return { FOUNDRY_README_EXAMPLES_TSC_OVERRIDE: stub, [JOBS_ENV]: String(jobs), ...extra };
}

// Highest number of stub runs that were open at the same moment, from the
// start/end lines the stub appends in real time.
function peakOverlap(traceFile) {
  const lines = readFileSync(traceFile, "utf8").split("\n").filter(Boolean);
  let open = 0;
  let peak = 0;
  for (const line of lines) {
    open += line === "start" ? 1 : -1;
    peak = Math.max(peak, open);
  }
  return peak;
}

// Eight blocks whose delays DEcrease with block number, so under any
// concurrency later blocks finish first and an output built in completion
// order would visibly differ from the README order. Covers a pass, a skip,
// two findings, an auto-wrapped finding (second pass), and a waived finding.
function makeMixedFixture(name) {
  const blocks = [];
  const add = (lang, delay, body, markers) => {
    blocks.push(["```" + lang, ...body, markerLine("STUB_DELAY_MS", delay), ...markers.map(([k, v]) => markerLine(k, v)), "```", ""].join("\n"));
  };
  add("ts", 400, ["const a = 1;"], [["STUB_DIAGNOSTICS", []]]);
  add("ts", 350, ["const b = 1;"], [["STUB_DIAGNOSTICS", [diag("TS2741", "Property 'caseSensitive' is missing.", 3, 5)]]]);
  add("ts", 300, ["assess(input);"], [["STUB_DIAGNOSTICS", [diag("TS2304", "Cannot find name 'input'.")]]]);
  add("tsx", 250, ["<A />", "<B />"], [
    ["STUB_DIAGNOSTICS", [diag("TS2657", "JSX expressions must have one parent element.")]],
    ["STUB_DIAGNOSTICS_WRAPPED", [diag("TS2322", "Type 'string' is not assignable to type 'number'.", 2, 5)]],
  ]);
  add("ts", 200, ["const e = 1;"], [["STUB_DIAGNOSTICS", [diag("TS2345", "waived fixture finding.", 2, 1)]]]);
  add("ts", 150, ["const f = 1;"], [["STUB_DIAGNOSTICS", []]]);
  add("ts", 100, ["const g = 1;"], [["STUB_DIAGNOSTICS", [diag("TS2322", "Another real finding.", 1, 7), diag("TS2339", "Second diagnostic.", 2, 1)]]]);
  add("ts", 50, ["const h = 1;"], [["STUB_DIAGNOSTICS", []]]);
  const pkgDir = makeFixturePackage(name, { readme: blocks.join("\n") });
  const waiverPath = join(workRoot, `waiver-${stubCounter++}.json`);
  writeFileSync(
    waiverPath,
    JSON.stringify({ issue: "#908", packages: { [basename(pkgDir)]: [{ block: 5, code: "TS2345", reason: "test fixture" }] } }),
  );
  return { pkgDir, waiverPath };
}

test("parallel run gives byte-identical findings, ordering and exit code to the sequential run (waived finding included)", () => {
  const stub = makeStubTsc();
  const { pkgDir, waiverPath } = makeMixedFixture("parity");
  const seq = run([pkgDir, "--waiver-file", waiverPath], { env: stubEnv(stub, 1) });
  const par = run([pkgDir, "--waiver-file", waiverPath], { env: stubEnv(stub, 4) });
  assert.equal(seq.status, 1);
  assert.equal(par.status, seq.status);
  assert.equal(par.stdout, seq.stdout);
  assert.equal(par.stderr, seq.stderr);
  // Guard the fixture itself: it must really exercise every report section.
  assert.match(seq.stdout, /8 ts\/tsx block\(s\) found — 3 compiled clean, 1 skipped, 4 finding\(s\) \(1 waived, 3 not\)/);
  assert.match(seq.stdout, /KNOWN, WAIVED/);
  assert.match(seq.stdout, /\[auto-wrapped\]/);
  // Findings are listed in README order (blocks 2, 4, 7), not completion order.
  const order = [...seq.stdout.matchAll(/^ {4}block (\d+) \(README\.md:\d+-\d+\)/gm)].map((m) => Number(m[1]));
  assert.deepEqual(order, [2, 4, 7]);
});

test("parallel --json output equals the sequential --json output", () => {
  const stub = makeStubTsc();
  const { pkgDir, waiverPath } = makeMixedFixture("parity-json");
  const seq = run([pkgDir, "--json", "--waiver-file", waiverPath], { env: stubEnv(stub, 1) });
  const par = run([pkgDir, "--json", "--waiver-file", waiverPath], { env: stubEnv(stub, 3) });
  assert.equal(par.status, seq.status);
  assert.equal(par.stdout, seq.stdout);
  assert.deepEqual(
    JSON.parse(par.stdout).findings.map((f) => f.block),
    [2, 4, 7],
  );
  assert.deepEqual(
    JSON.parse(par.stdout).waived.map((w) => w.block),
    [5],
  );
});

test("a stale waiver and a waived finding behave the same in parallel", () => {
  const stub = makeStubTsc();
  const { pkgDir } = makeMixedFixture("parity-stale");
  const waiverPath = join(workRoot, `waiver-${stubCounter++}.json`);
  writeFileSync(
    waiverPath,
    JSON.stringify({
      issue: "#908",
      packages: { [basename(pkgDir)]: [{ block: 5, code: "TS2345", reason: "live" }, { block: 6, code: "TS2345", reason: "stale" }] },
    }),
  );
  const seq = run([pkgDir, "--waiver-file", waiverPath], { env: stubEnv(stub, 1) });
  const par = run([pkgDir, "--waiver-file", waiverPath], { env: stubEnv(stub, 4) });
  assert.match(seq.stdout, /STALE WAIVER/);
  assert.equal(par.status, seq.status);
  assert.equal(par.stdout, seq.stdout);
});

test("the worker count bounds real concurrency: JOBS=1 never overlaps, JOBS=3 overlaps but never exceeds 3", () => {
  const stub = makeStubTsc();
  const { pkgDir, waiverPath } = makeMixedFixture("bounded");
  const traceFor = (jobs) => {
    const traceFile = join(workRoot, `trace-${stubCounter++}.log`);
    writeFileSync(traceFile, "");
    run([pkgDir, "--waiver-file", waiverPath], { env: stubEnv(stub, jobs, { STUB_TRACE_FILE: traceFile }) });
    return peakOverlap(traceFile);
  };
  assert.equal(traceFor(1), 1);
  const peak = traceFor(3);
  assert.ok(peak >= 2, `expected overlapping runs with JOBS=3, saw peak ${peak}`);
  assert.ok(peak <= 3, `expected at most 3 concurrent runs with JOBS=3, saw peak ${peak}`);
});

test("without the env var the default is bounded (at most 4) and still overlaps on a multi-core machine", () => {
  const stub = makeStubTsc();
  const { pkgDir, waiverPath } = makeMixedFixture("default-jobs");
  const traceFile = join(workRoot, `trace-${stubCounter++}.log`);
  writeFileSync(traceFile, "");
  const env = { FOUNDRY_README_EXAMPLES_TSC_OVERRIDE: stub, STUB_TRACE_FILE: traceFile };
  const result = run([pkgDir, "--waiver-file", waiverPath], { env: { ...env, [JOBS_ENV]: "" } });
  assert.equal(result.status, 1);
  const peak = peakOverlap(traceFile);
  assert.ok(peak <= 4, `default must cap at 4 concurrent runs, saw ${peak}`);
  if (availableParallelism() >= 3) assert.ok(peak >= 2, `default should overlap on ${availableParallelism()} CPUs, saw ${peak}`);
});

test("a tsc run that fails with no diagnostic fails the whole check in parallel (exit 2), not swallowed", () => {
  const stub = makeStubTsc();
  const blocks = [];
  for (let i = 1; i <= 6; i += 1) {
    const markers = i === 4 ? [markerLine("STUB_ANOMALY", true)] : [markerLine("STUB_DIAGNOSTICS", [])];
    blocks.push(["```ts", `const v${i} = ${i};`, markerLine("STUB_DELAY_MS", 60 * (7 - i)), ...markers, "```", ""].join("\n"));
  }
  const pkgDir = makeFixturePackage("worker-anomaly", { readme: blocks.join("\n") });
  const seq = run([pkgDir], { env: stubEnv(stub, 1) });
  const par = run([pkgDir], { env: stubEnv(stub, 4) });
  assert.equal(par.status, 2);
  assert.match(par.stderr, /1 block\(s\) could not be evaluated/);
  assert.match(par.stderr, /block 4:/);
  assert.doesNotMatch(par.stdout, /PASS/);
  assert.equal(par.status, seq.status);
  assert.equal(par.stderr, seq.stderr);
});

test("several failing runs are all reported, in README order, in parallel", () => {
  const stub = makeStubTsc();
  const blocks = [];
  for (let i = 1; i <= 5; i += 1) {
    const marker = i === 2 || i === 5 ? markerLine("STUB_ANOMALY", true) : markerLine("STUB_DIAGNOSTICS", []);
    blocks.push(["```ts", `const v${i} = ${i};`, markerLine("STUB_DELAY_MS", 60 * (6 - i)), marker, "```", ""].join("\n"));
  }
  const pkgDir = makeFixturePackage("worker-anomalies", { readme: blocks.join("\n") });
  const par = run([pkgDir], { env: stubEnv(stub, 4) });
  assert.equal(par.status, 2);
  assert.match(par.stderr, /2 block\(s\) could not be evaluated/);
  assert.deepEqual([...par.stderr.matchAll(/^ {2}block (\d+):/gm)].map((m) => Number(m[1])), [2, 5]);
});

test("a tsc run killed by a signal (crashed worker) fails the check in parallel, not swallowed", () => {
  const stub = makeStubTsc();
  const blocks = [];
  for (let i = 1; i <= 4; i += 1) {
    const marker = i === 3 ? markerLine("STUB_CRASH", true) : markerLine("STUB_DIAGNOSTICS", []);
    blocks.push(["```ts", `const v${i} = ${i};`, marker, "```", ""].join("\n"));
  }
  const pkgDir = makeFixturePackage("worker-crash", { readme: blocks.join("\n") });
  const par = run([pkgDir], { env: stubEnv(stub, 4) });
  assert.equal(par.status, 2);
  assert.match(par.stderr, /could not be evaluated/);
  assert.match(par.stderr, /block 3:/);
  assert.doesNotMatch(par.stdout, /PASS/);
});

test("a failing run in the auto-wrap retry pass is also not swallowed in parallel", () => {
  const stub = makeStubTsc();
  const raw = [diag("TS2657", "JSX expressions must have one parent element.")];
  const readme = [
    "```tsx",
    "<A />",
    "<B />",
    markerLine("STUB_DIAGNOSTICS", raw),
    markerLine("STUB_ANOMALY_WRAPPED", true),
    "```",
    "",
    "```ts",
    "const ok = 1;",
    markerLine("STUB_DIAGNOSTICS", []),
    "```",
    "",
  ].join("\n");
  const pkgDir = makeFixturePackage("retry-anomaly", { readme });
  const par = run([pkgDir], { env: stubEnv(stub, 4) });
  assert.equal(par.status, 2);
  assert.match(par.stderr, /block 1 \(fragment retry\):/);
});

test("a worker that throws inside the harness (not a tsc result) fails the check closed, exit 2", () => {
  const stub = makeStubTsc();
  const blocks = [
    ["```ts", "const a = 1;", markerLine("STUB_SABOTAGE", true), markerLine("STUB_DIAGNOSTICS", []), "```", ""],
    ["```ts", "const b = 1;", markerLine("STUB_DELAY_MS", 600), markerLine("STUB_DIAGNOSTICS", []), "```", ""],
    ["```ts", "const c = 1;", markerLine("STUB_DIAGNOSTICS", []), "```", ""],
  ].map((lines) => lines.join("\n"));
  const pkgDir = makeFixturePackage("worker-throws", { readme: blocks.join("\n") });
  // JOBS=2: slot 0 runs block 1 (and sabotages itself), slot 1 is held open
  // by block 2, so block 3 lands on the sabotaged slot and the write throws.
  const par = run([pkgDir], { env: stubEnv(stub, 2) });
  assert.equal(par.status, 2);
  assert.match(par.stderr, /a compile worker failed/);
  assert.doesNotMatch(par.stdout, /PASS/);
  // Control: the same README with no sabotage passes in parallel.
  const control = makeFixturePackage("worker-throws-control", { readme: blocks.join("\n").replace(markerLine("STUB_SABOTAGE", true), "") });
  assert.equal(run([control], { env: stubEnv(stub, 2) }).status, 0);
});

test("invalid worker counts are refused with exit 2 rather than silently defaulted", () => {
  const stub = makeStubTsc();
  const readme = ["```ts", "const x = 1;", markerLine("STUB_DIAGNOSTICS", []), "```", ""].join("\n");
  const pkgDir = makeFixturePackage("bad-jobs", { readme });
  for (const bad of ["0", "-2", "abc", "1.5", "4x"]) {
    const result = run([pkgDir], { env: stubEnv(stub, bad) });
    assert.equal(result.status, 2, `JOBS=${bad}`);
    assert.match(result.stderr, /FOUNDRY_README_EXAMPLES_JOBS/);
  }
});
