import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Hermetic negative controls for scripts/check-touches-packages.mjs and for
// the two steps in .github/workflows/ci.yml's `build` job it gates
// ("Candidate qualification records", "Packed consumer readiness"). Every
// fixture is a real, throwaway git repo under mkdtemp; the real script is
// spawned exactly the way the workflow spawns it, reading nothing from this
// repository's own git history or network. Modelled on
// scripts/check-release-readiness.test.mjs's own fixture shape.

const scriptDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(scriptDir, "check-touches-packages.mjs");
const workflowPath = resolve(scriptDir, "..", ".github", "workflows", "ci.yml");

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function gitCommit(dir, message) {
  git(["add", "-A"], dir);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", message], dir);
  return git(["rev-parse", "HEAD"], dir).trim();
}

// A base commit shaped like this repository's own root: a package under
// packages/, a root package.json and package-lock.json, and a Markdown
// file, so every control below can change exactly one of those and nothing
// else.
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "touches-packages-"));
  git(["init", "-q", "-b", "main"], dir);
  mkdirSync(join(dir, "packages", "probe", "src"), { recursive: true });
  writeFileSync(join(dir, "packages", "probe", "package.json"), '{"name":"probe","version":"1.0.0"}\n');
  writeFileSync(join(dir, "packages", "probe", "src", "index.ts"), "export const x = 1;\n");
  writeFileSync(join(dir, "package.json"), '{"name":"root","private":true}\n');
  writeFileSync(join(dir, "package-lock.json"), '{"lockfileVersion":3}\n');
  writeFileSync(join(dir, "SECURITY.md"), "# Security\n");
  const baseSha = gitCommit(dir, "base");
  return { dir, baseSha };
}

// Spawns the real script exactly the way the workflow step does: cwd inside
// the fixture repo, GITHUB_EVENT_NAME/BASE_SHA/GITHUB_OUTPUT as env vars.
// Returns { exitStatus, stdout, touches } — `touches` is the parsed value of
// the last `touches=` line written to $GITHUB_OUTPUT, or undefined if none
// was written at all (the "output never even got written" case).
function runDetector(dir, { baseSha, eventName = "pull_request" } = {}) {
  const outputFile = join(dir, ".github-output");
  writeFileSync(outputFile, "");
  let stdout;
  let exitStatus = 0;
  try {
    stdout = execFileSync("node", [scriptPath], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: eventName,
        BASE_SHA: baseSha ?? "",
        GITHUB_OUTPUT: outputFile,
      },
    });
  } catch (error) {
    exitStatus = typeof error.status === "number" ? error.status : 1;
    stdout = error.stdout ?? "";
  }
  const outputText = existsSync(outputFile) ? readFileSync(outputFile, "utf8") : "";
  const matches = [...outputText.matchAll(/^touches=(.+)$/gm)];
  const touches = matches.length > 0 ? matches[matches.length - 1][1] : undefined;
  return { exitStatus, stdout, touches };
}

test("the script itself always exits 0 — it is a router, never a gate", () => {
  const { dir, baseSha } = makeRepo();
  writeFileSync(join(dir, "SECURITY.md"), "# Security\n\nUpdated.\n");
  gitCommit(dir, "docs only");
  const { exitStatus } = runDetector(dir, { baseSha });
  assert.equal(exitStatus, 0);
});

// (a) A pull request touching only a Markdown file — the expensive steps
// must be provably skippable.
test("control (a): a Markdown-only change reports touches=false", () => {
  const { dir, baseSha } = makeRepo();
  writeFileSync(join(dir, "SECURITY.md"), "# Security\n\nUpdated wording.\n");
  gitCommit(dir, "docs only");
  const { touches } = runDetector(dir, { baseSha });
  assert.equal(touches, "false");
});

// (b) A pull request touching any file under packages/** — must run.
test("control (b): a packages/** change reports touches=true", () => {
  const { dir, baseSha } = makeRepo();
  writeFileSync(join(dir, "packages", "probe", "src", "index.ts"), "export const x = 2;\n");
  gitCommit(dir, "package source change");
  const { touches } = runDetector(dir, { baseSha });
  assert.equal(touches, "true");
});

// (c) A pull request touching package-lock.json — must run. (Also proves
// root package.json is covered, by the same mechanism.)
test("control (c): a package-lock.json change reports touches=true", () => {
  const { dir, baseSha } = makeRepo();
  writeFileSync(join(dir, "package-lock.json"), '{"lockfileVersion":3,"changed":true}\n');
  gitCommit(dir, "lockfile bump");
  const { touches } = runDetector(dir, { baseSha });
  assert.equal(touches, "true");
});

test("control (c2): a root package.json change reports touches=true", () => {
  const { dir, baseSha } = makeRepo();
  writeFileSync(join(dir, "package.json"), '{"name":"root","private":true,"changed":true}\n');
  gitCommit(dir, "root manifest change");
  const { touches } = runDetector(dir, { baseSha });
  assert.equal(touches, "true");
});

test("control (c3): a governance/** change reports touches=true even though nothing under packages/ moved", () => {
  const { dir, baseSha } = makeRepo();
  mkdirSync(join(dir, "governance", "release-qualifications"), { recursive: true });
  writeFileSync(join(dir, "governance", "release-qualifications", "probe.json"), "{}\n");
  gitCommit(dir, "add qualification record");
  const { touches } = runDetector(dir, { baseSha });
  assert.equal(touches, "true");
});

test("control (c4): a scripts/** change reports touches=true (covers the checker scripts' own lib/ dependencies)", () => {
  const { dir, baseSha } = makeRepo();
  mkdirSync(join(dir, "scripts", "lib"), { recursive: true });
  writeFileSync(join(dir, "scripts", "lib", "packed-consumer-readiness.mjs"), "export const x = 1;\n");
  gitCommit(dir, "touch a checker's own lib module");
  const { touches } = runDetector(dir, { baseSha });
  assert.equal(touches, "true");
});

// (d) The detection step failing, or producing an empty diff, must RUN —
// never skip. Two independent ways detection can fail:
test("control (d1): an unresolvable BASE_SHA is a detection failure — reports touches=true, still exits 0", () => {
  const { dir } = makeRepo();
  const { exitStatus, touches, stdout } = runDetector(dir, { baseSha: "0000000000000000000000000000000000dead" });
  assert.equal(exitStatus, 0, "must never fail the job");
  assert.equal(touches, "true", "an unresolvable base must fail SAFE (run), not skip");
  assert.match(stdout, /did not resolve/);
});

test("control (d2): an empty diff against the merge base (HEAD == base) is treated as a detection failure — reports touches=true", () => {
  const { dir, baseSha } = makeRepo();
  // No further commit: HEAD is the base commit itself, so the diff between
  // merge-base and HEAD is empty. A real pull request always changes
  // something, so this shape only occurs when detection itself has gone
  // wrong (e.g. comparing a ref against itself) — never treat it as "a
  // genuinely empty, harmless PR".
  const { exitStatus, touches, stdout } = runDetector(dir, { baseSha });
  assert.equal(exitStatus, 0);
  assert.equal(touches, "true");
  assert.match(stdout, /zero changed paths/);
});

test("control (d3): a non-pull_request event (push to main) always reports touches=true", () => {
  const { dir, baseSha } = makeRepo();
  writeFileSync(join(dir, "SECURITY.md"), "# Security\n\nUpdated.\n");
  gitCommit(dir, "docs only, but on push");
  const { touches } = runDetector(dir, { baseSha, eventName: "push" });
  assert.equal(touches, "true");
});

test("control (d4): a missing BASE_SHA (empty string) reports touches=true", () => {
  const { dir } = makeRepo();
  const { touches } = runDetector(dir, { baseSha: "" });
  assert.equal(touches, "true");
});

// (e) The job must still REPORT its status context in the skip case — the
// required check must never simply stop appearing. Proven structurally:
// the two conditioned steps carry a step-level `if:`, never a job-level
// `if:` on `build` itself (a job-level `if:` evaluating false is how a
// required context stops reporting at all), and the polarity is
// fail-closed (`!= 'false'`, never `== 'true'`), and the gating step itself
// is `continue-on-error: true` so its own failure cannot stop the job
// either.
test("control (e): the build job always reports its required status context on pull_request", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const start = workflow.indexOf("  build:\n");
  assert.notEqual(start, -1, "workflow is missing the build job");
  const rest = workflow.slice(start + 1);
  const next = rest.search(/^  [a-z][a-z0-9-]*:\n/m);
  const build = workflow.slice(start, next === -1 ? workflow.length : start + 1 + next);

  assert.match(build, /^\s+name: build and test$/m, "the required context name must be present");
  // A job-level `if:` that is false on pull_request is how a required
  // context stops reporting. Skipping a tree-identical push to main is
  // allowed: that tree already passed on the PR head.
  const jobIf = build.match(/^ {4}if: (.+)$/m);
  if (jobIf) {
    assert.match(
      jobIf[1],
      /github\.event_name != 'push'/,
      "any job-level if on build must remain true for every pull_request",
    );
  }

  assert.doesNotMatch(build, /needs: \[safety, scope\]/, "build must not wait for safety/scope before starting");

  assert.match(
    build,
    /- name: Detect whether this change touches packages\n\s+id: touch\n\s+continue-on-error: true/,
    "the detector step must be continue-on-error: true, so its own failure cannot stop the job",
  );

  const candidateStep = build.slice(build.indexOf("- name: Candidate qualification records"));
  assert.match(
    candidateStep.split("\n- name:")[0],
    /if: steps\.touch\.outputs\.touches != 'false'/,
    "must skip only on an explicit 'false', never require an explicit 'true' to run",
  );
  assert.doesNotMatch(
    candidateStep.split("\n- name:")[0],
    /if: steps\.touch\.outputs\.touches == 'true'/,
    "must not require an explicit 'true' to run — that polarity fails CLOSED on any unset/garbled output",
  );

  const packedStep = build.slice(build.indexOf("- name: Packed consumer readiness"));
  assert.match(
    packedStep.split("\n- name:")[0],
    /if: steps\.touch\.outputs\.touches != 'false'/,
  );
});
