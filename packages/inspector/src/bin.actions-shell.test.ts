// ---------------------------------------------------------------------
// This suite spawns the REAL compiled `dist/bin.js` — not `main` in-process,
// not `cli.js` (which only exports `main` and never calls it) — through a
// REAL `bash -e` subprocess, the shell GitHub Actions actually runs a
// `run:` block under. Nothing here is simulated:
//
//   - `execFileSync("bash", ["-e", "-c", script], ...)` is exactly the shell
//     invocation Actions uses (`bash -e {0}`, `-o pipefail` NOT set by
//     default), so a shell-level defect — a swallowed exit code inside a
//     pipeline, `-e` not aborting on a captured `||` failure, `exit` not
//     being the step's real status — shows up here as a real subprocess
//     exit code, not as an assertion someone might get wrong in a mock.
//   - the CLI path is `dist/bin.js`, the same compiled entry point this
//     repository's own `.github/workflows/verify-standards.yml` invokes
//     (`node packages/inspector/dist/bin.js ...`) and the same one
//     `documents/caller-workflow.md`'s template invokes via `npx inspector`.
//     Gates in this repository are reached by dist PATH, never by bin name
//     (see packages/builder's own `dist/ci/bin.js` reachability suite for
//     the regression this guards against) — this test resolves that exact
//     path and executes it, so a CLI that only worked when imported as a
//     module, or only worked under a name-keyed dispatch, would fail here.
//
// What no other test in this package's suite covers: `src/cli.test.ts`
// asserts `main`'s return value against an in-memory `CliPort` — real
// unit coverage of the decision logic, but it never spawns a process and
// never touches a shell, so it cannot see what `bash -e` does to that
// return value on the way to becoming a step's real exit status. That gap
// is issue #283's one open acceptance criterion, and this file is what
// closes it.
// ---------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VERIFY_STANDARDS_INPUTS_VERSION } from "./verify.js";

const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "bin.js");

/** A clean secret-scan observation: the `secret-scan` check evaluates this as `satisfied`. */
const satisfiedInputs = {
  schemaVersion: VERIFY_STANDARDS_INPUTS_VERSION,
  secretScan: {
    observation: {
      attempted: true,
      toolName: "example-scanner",
      toolVersion: "8.30.1",
      exitCode: 0,
      scope: "full-history",
      unitsScanned: 5,
      hits: [],
    },
  },
};

/** A secret-scan observation carrying a real hit: evaluates as `violated`. */
const violatedInputs = {
  schemaVersion: VERIFY_STANDARDS_INPUTS_VERSION,
  secretScan: {
    observation: {
      attempted: true,
      toolName: "example-scanner",
      toolVersion: "8.30.1",
      exitCode: 1,
      scope: "full-history",
      unitsScanned: 5,
      hits: [{ ruleId: "generic-api-key", path: "src/a.ts" }],
    },
  },
};

/** No `taskRecord` observation supplied at all: `task-record` cannot evaluate — `indeterminate`. */
const indeterminateInputs = { schemaVersion: VERIFY_STANDARDS_INPUTS_VERSION };

let dir: string;

beforeEach(() => {
  // A synthetic per-test temp directory, not a fixed or hard-coded path —
  // this file is tracked in a public repository and must never carry a
  // real absolute path or home directory into the tree.
  dir = mkdtempSync(join(tmpdir(), "inspector-actions-shell-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeInputs(name: string, value: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value), "utf8");
  return path;
}

interface ShellResult {
  readonly status: number;
  readonly stdout: string;
}

// The exact caller pattern documented in .github/workflows/verify-standards.yml
// (the "DECIDE" step) and this package's own documents/caller-workflow.md's
// template: never let the decisive command sit on the left of a pipe, capture
// its status explicitly with `||`, consume the report, then `exit "$status"`.
// Paths and the check name are positional parameters: no fixture- or
// environment-derived text becomes shell source.
const SAFE_CALLER_SCRIPT = `
    set -o pipefail
    report="$4"
    status=0
    node "$1" --inputs "$2" --checks "$3" > "$report" || status=$?
    while IFS= read -r line || [ -n "$line" ]; do :; done < "$report"
    exit "$status"
  `;

const DIRECT_CALLER_SCRIPT = 'node "$1" --inputs "$2" --checks "$3"';
const NAIVE_PIPE_SCRIPT = 'node "$1" --inputs "$2" --checks "$3" | while IFS= read -r line || [ -n "$line" ]; do :; done';
const PIPEFAIL_CALLER_SCRIPT = `set -o pipefail
${NAIVE_PIPE_SCRIPT}`;

type ActionsShellCase = "safe" | "direct" | "naive-pipe" | "pipefail";

/** Runs one closed, source-owned script under the real Actions shell; fixture values travel only as positional argv. */
function runUnderActionsShell(shellCase: ActionsShellCase, args: readonly string[]): ShellResult {
  let script: string;
  switch (shellCase) {
    case "safe":
      script = SAFE_CALLER_SCRIPT;
      break;
    case "direct":
      script = DIRECT_CALLER_SCRIPT;
      break;
    case "naive-pipe":
      script = NAIVE_PIPE_SCRIPT;
      break;
    case "pipefail":
      script = PIPEFAIL_CALLER_SCRIPT;
      break;
  }

  try {
    const stdout = execFileSync("bash", ["-e", "-c", script, "inspector-actions-shell-test", ...args], { encoding: "utf8" });
    return { status: 0, stdout };
  } catch (error) {
    const err = error as { status?: number | null; stdout?: string };
    return { status: typeof err.status === "number" ? err.status : Number.NaN, stdout: err.stdout ?? "" };
  }
}

describe("dist/bin.js under real Actions shell semantics (bash -e)", () => {
  it("the documented caller pattern exits 0 for a satisfied run", () => {
    const inputsPath = writeInputs("satisfied.json", satisfiedInputs);
    const reportPath = join(dir, "report-satisfied.txt");
    const result = runUnderActionsShell("safe", [cliPath, inputsPath, "secret-scan", reportPath]);
    expect(result.status).toBe(0);
  });

  it("the documented caller pattern exits 1, not 0, for a violated run", () => {
    const inputsPath = writeInputs("violated.json", violatedInputs);
    const reportPath = join(dir, "report-violated.txt");
    const result = runUnderActionsShell("safe", [cliPath, inputsPath, "secret-scan", reportPath]);
    expect(result.status).toBe(1);
  });

  // The one exit state issue #283 calls out by name: this is the assertion
  // that never existed before this file. `set -e` alone does not save a
  // caller here — the decisive command is deliberately captured with `||`
  // (guard 2 in the workflow's own comment), which is exactly the construct
  // that keeps `-e` from aborting the step BEFORE `exit "$status"` gets to
  // run. This proves that construct still reports the real code, rather
  // than merely trusting the comment that says it does.
  it("the documented caller pattern exits 2, and fails closed, for an indeterminate run", () => {
    const inputsPath = writeInputs("indeterminate.json", indeterminateInputs);
    const reportPath = join(dir, "report-indeterminate.txt");
    const result = runUnderActionsShell("safe", [cliPath, inputsPath, "task-record", reportPath]);
    expect(result.status).toBe(2);
  });

  it("a bare direct invocation under bash -e (no capture) still surfaces the real indeterminate exit code", () => {
    // No `|| status=$?`, no report file — the CLI is the step's only and
    // last command, so `-e` propagates its exit code as the script's own.
    // This is the shell-level fail-closed property the caller pattern above
    // is built on top of: `-e` does not need help to NOT swallow a `2`, it
    // is the pipe (or an unguarded `||`/`if`) that would.
    const inputsPath = writeInputs("indeterminate-direct.json", indeterminateInputs);
    const result = runUnderActionsShell("direct", [cliPath, inputsPath, "task-record"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("Overall: INDETERMINATE (exit 2)");
  });

  // ---- The negative control ----------------------------------------------
  // This is the failure mode the workflow's own "DECIDE" step comment and
  // documents/caller-workflow.md's "On never piping the decision step"
  // section both warn about, by name, in prose. Nothing before this test
  // actually put a real `bash -e` process through it. If this test ever
  // fails to reproduce the swallow, the documentation is describing a bug
  // that no longer exists and should be corrected — it does reproduce, so
  // the documentation's warning is accurate and the safe pattern above is
  // demonstrated to be load-bearing, not decorative.
  it("documents the defect the safe pattern exists to avoid: a naive pipe under bash -e (no pipefail) swallows a real 1 or 2 into a false 0", () => {
    for (const [name, inputs, checks] of [
      ["violated", violatedInputs, "secret-scan"],
      ["indeterminate", indeterminateInputs, "task-record"],
    ] as const) {
      const inputsPath = writeInputs(`naive-${name}.json`, inputs);
      const result = runUnderActionsShell("naive-pipe", [cliPath, inputsPath, checks]);
      expect(result.status).toBe(0);
    }
  });

  it("the same naive pipe reports its real status once `set -o pipefail` is added — the doc's stated first guard", () => {
    const inputsPath = writeInputs("pipefail-guard.json", indeterminateInputs);
    const result = runUnderActionsShell("pipefail", [cliPath, inputsPath, "task-record"]);
    expect(result.status).toBe(2);
  });
});
