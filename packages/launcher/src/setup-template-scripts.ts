/**
 * Pure renderers for the setup template acts' script and workflow files.
 *
 * Each renderer returns exact file bytes; path scope optionally takes the
 * supported authoring agent provenance. With no input it preserves legacy
 * bytes. Rendering is pure, so
 * the text is a pure function of this module alone: no clock, no randomness,
 * no filesystem, no environment. Everything that reads a clock or a
 * repository does so inside the emitted script, when a workflow runs it, and
 * never here.
 *
 * Files rendered here:
 * - `.github/scripts/clossys-collect-adoption-snapshot.mjs`
 * - `.github/workflows/clossys-adoption-evidence.yml`
 * - `.github/workflows/clossys-path-scope.yml`
 *
 * The path-scope script is standalone, so it runs the same under a test as it
 * does inside the workflow that embeds it.
 */

/**
 * The path patterns an apply pull request may own, in the change-set
 * contract's order. The path-scope script embeds this list.
 */
export const OWNED_PATH_PATTERNS: readonly string[] = [
  "clossys/**",
  ".agents/skills/clossys-*/**",
  ".claude/skills/clossys-*",
  ".cursor/skills/clossys-*",
  "AGENTS.md",
  "CLAUDE.md",
  ".starter/request.json",
  ".github/workflows/clossys-*",
  ".github/scripts/clossys-*",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  ".yarnrc.yml",
  "pnpm-workspace.yaml",
  "**/repository-profile.json",
  "**/repository-declaration.json",
];

const CHECKOUT = "actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0";
const UPLOAD_ARTIFACT = "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7";
const HEREDOC_TERMINATOR = "CLOSSYS_PATH_SCOPE";

// ---------------------------------------------------------------------------
// The snapshot collector script
// ---------------------------------------------------------------------------

// The emitted scripts' module import lines are kept as quoted strings so that no
// line of this module's own source begins with an import statement.
const COLLECTOR_IMPORTS = [
  'import { createHash } from "node:crypto";',
  'import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";',
  'import { dirname, resolve, sep } from "node:path";',
].join("\n");
const PATH_SCOPE_IMPORTS = 'import { execFileSync } from "node:child_process";';

const SNAPSHOT_COLLECTOR = String.raw`// Clossys adoption snapshot collector.
//
// This script is consumer-owned: it lives in this repository, and you review
// and change it like any other code here. It is uncredentialed. It reads no
// package or registry secret, installs nothing, and runs no package, Advisor
// or target command. The trusted decision job never reads or trusts what this
// script produces, because a pull request controls the workflow that runs it
// and can change this file.
//
// Usage: node clossys-collect-adoption-snapshot.mjs <request.json> <output-dir>
//
// From the request it takes snapshot.repository, evidence.assessment and
// evidence.targetInput. It copies exactly those two files, found relative to
// the working directory (the repository root), into <output-dir>, and writes
// <output-dir>/snapshot.json with the pull request facts from the environment
// (REPOSITORY, PR_NUMBER, BASE_SHA, HEAD_SHA, RUN_ID) and each file's size and
// SHA-256.
//
// It refuses, with exit code 2 and one line on stderr, a request or an
// environment value it cannot vouch for; an evidence path that is not a
// normalized relative path, is missing, is a symlink, is not a regular file, or
// is larger than 524288 bytes; and an output directory that already holds
// anything. A refusal leaves nothing half-written.
${COLLECTOR_IMPORTS}

const NAME = "clossys-collect-adoption-snapshot";
const MAX_BYTES = 524288;
const COMMIT = /^[0-9a-f]{40}$/;

class Refusal extends Error {}

function refuse(message) {
  throw new Refusal(message);
}

function show(text) {
  return String(text).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "?").slice(0, 200);
}

function env(name) {
  const value = process.env[name];
  return typeof value === "string" ? value : "";
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNormalizedRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 240) return false;
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  return value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function readBounded(path, label) {
  let link;
  try {
    link = lstatSync(path);
  } catch {
    refuse(label + " is missing or unreadable");
  }
  if (link.isSymbolicLink() || !link.isFile()) refuse(label + " is not a regular non-symlink file");
  if (link.size > MAX_BYTES) refuse(label + " is larger than " + MAX_BYTES + " bytes");
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  } catch {
    refuse(label + " cannot be opened");
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES) refuse(label + " is not a bounded regular file");
    const content = readFileSync(fd);
    if (content.length > MAX_BYTES) refuse(label + " is larger than " + MAX_BYTES + " bytes");
    return content;
  } finally {
    closeSync(fd);
  }
}

function readEvidence(root, path) {
  const label = "evidence file " + show(path);
  const candidate = resolve(root, path);
  if (!candidate.startsWith(root + sep)) refuse(label + " is outside the working directory");
  let real;
  try {
    real = realpathSync(candidate);
  } catch {
    refuse(label + " is missing or unreadable");
  }
  if (real !== candidate) refuse(label + " passes through a symbolic link");
  return readBounded(candidate, label);
}

function readRequest(requestArgument) {
  const content = readBounded(resolve(requestArgument), "request file");
  let request;
  try {
    request = JSON.parse(content.toString("utf8"));
  } catch {
    refuse("the request is not valid JSON");
  }
  if (!isRecord(request) || !isRecord(request.snapshot) || typeof request.snapshot.repository !== "string" || request.snapshot.repository === "") {
    refuse("the request has no snapshot.repository");
  }
  if (!isRecord(request.evidence)) refuse("the request has no evidence paths");
  const assessment = request.evidence.assessment;
  const targetInput = request.evidence.targetInput;
  if (!isNormalizedRelativePath(assessment)) refuse("the request's evidence.assessment is not a normalized relative path");
  if (!isNormalizedRelativePath(targetInput)) refuse("the request's evidence.targetInput is not a normalized relative path");
  if (assessment === targetInput) refuse("the request names the same evidence path twice; the two must be distinct");
  for (const path of [assessment, targetInput]) {
    if (path.toLowerCase() === "snapshot.json") refuse("the request's evidence path " + show(path) + " collides with snapshot.json");
  }
  return { repository: request.snapshot.repository, paths: [assessment, targetInput] };
}

function readEnvironment(repository) {
  if (env("REPOSITORY") !== repository) refuse("REPOSITORY does not equal the request's snapshot.repository");
  const pullRequest = env("PR_NUMBER");
  if (!/^[1-9][0-9]*$/.test(pullRequest) || !Number.isSafeInteger(Number(pullRequest))) refuse("PR_NUMBER is not a positive safe integer");
  const baseSha = env("BASE_SHA");
  if (!COMMIT.test(baseSha)) refuse("BASE_SHA is not a 40-character lowercase hex commit");
  const headSha = env("HEAD_SHA");
  if (!COMMIT.test(headSha)) refuse("HEAD_SHA is not a 40-character lowercase hex commit");
  const runId = env("RUN_ID");
  if (!/^[0-9]+$/.test(runId)) refuse("RUN_ID is not a non-empty run of digits");
  return { pullRequestNumber: Number(pullRequest), baseSha, headSha, runId };
}

function checkOutputDirectory(out) {
  let stat = null;
  try {
    stat = lstatSync(out);
  } catch (error) {
    if (!error || error.code !== "ENOENT") refuse("the output directory cannot be inspected");
  }
  if (stat === null) return;
  if (stat.isSymbolicLink() || !stat.isDirectory()) refuse("the output path exists and is not a directory");
  if (readdirSync(out).length > 0) refuse("the output directory already exists and is not empty");
}

function write(out, files, manifestText) {
  let firstCreated;
  try {
    firstCreated = mkdirSync(out, { recursive: true });
    for (const file of files) {
      const target = resolve(out, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content, { flag: "wx" });
    }
    writeFileSync(resolve(out, "snapshot.json"), manifestText, { flag: "wx" });
  } catch {
    try {
      if (firstCreated !== undefined) rmSync(firstCreated, { recursive: true, force: true });
      else for (const name of readdirSync(out)) rmSync(resolve(out, name), { recursive: true, force: true });
    } catch {
      // Nothing more can be done; the refusal below still reports the failure.
    }
    refuse("the snapshot could not be written");
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] === "" || args[1] === "") refuse("usage: node clossys-collect-adoption-snapshot.mjs <request.json> <output-dir>");
  const out = resolve(args[1]);
  const request = readRequest(args[0]);
  const facts = readEnvironment(request.repository);
  checkOutputDirectory(out);

  const root = realpathSync(process.cwd());
  const files = request.paths.map((path) => ({ path, content: readEvidence(root, path) }));
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

  const before = {
    schemaVersion: 1,
    provider: "github-actions",
    eventName: "pull_request",
    repository: request.repository,
    pullRequestNumber: facts.pullRequestNumber,
    baseSha: facts.baseSha,
    headSha: facts.headSha,
    workflowRunId: facts.runId,
    artifactName: "adoption-snapshot-" + facts.runId,
  };
  const capturedAt = new Date().toISOString();
  const listed = files.map((file) => ({ path: file.path, size: file.content.length, sha256: sha256(file.content) }));
  const digest = sha256(Buffer.from(JSON.stringify({ ...before, capturedAt, files: listed }, null, 2), "utf8"));
  const manifest = { ...before, digest, capturedAt, files: listed };

  write(out, files, JSON.stringify(manifest, null, 2) + "\n");
  console.log(NAME + ": wrote " + files.length + " evidence file(s) and snapshot.json");
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(NAME + ": " + (error instanceof Refusal ? show(error.message) : "unexpected failure"));
  process.exitCode = 2;
}
`;

/** The bytes of `.github/scripts/clossys-collect-adoption-snapshot.mjs`. */
export function renderSnapshotCollector(): string {
  return SNAPSHOT_COLLECTOR;
}

// ---------------------------------------------------------------------------
// The adoption evidence workflow
// ---------------------------------------------------------------------------

const ADOPTION_EVIDENCE_WORKFLOW = [
  "# Clossys adoption evidence, written by Clossys Launcher.",
  "#",
  "# This is the uncredentialed half of the adoption check. It runs on",
  "# pull_request, checks out the pull request head with no persisted credential,",
  "# and uploads a small snapshot of two evidence files as an artifact. It holds no",
  "# secret, installs nothing, and runs no package, Advisor or target command.",
  "#",
  "# The artifact this workflow uploads is NOT read by the trusted decision job.",
  "# A pull request controls this workflow and can edit it, so what it produces is",
  "# not evidence the decision trusts.",
  "#",
  "# The collector is a plain script in this repository:",
  "# .github/scripts/clossys-collect-adoption-snapshot.mjs. It reads the two",
  "# evidence paths named by .starter/request.json and copies exactly those files.",
  "name: Clossys adoption evidence",
  "",
  "on:",
  "  pull_request:",
  "    types: [opened, synchronize, reopened]",
  "",
  "permissions:",
  "  contents: read",
  "",
  "jobs:",
  "  collect-adoption-evidence:",
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 10",
  "    steps:",
  "      - name: Check out the pull request head",
  `        uses: ${CHECKOUT}`,
  "        with:",
  "          ref: ${{ github.event.pull_request.head.sha }}",
  "          persist-credentials: false",
  "",
  "      # Values reach the script only through the environment, never through its",
  "      # text. The script runs no package, Advisor or target command.",
  "      - name: Collect the snapshot",
  "        env:",
  "          REPOSITORY: ${{ github.repository }}",
  "          PR_NUMBER: ${{ github.event.pull_request.number }}",
  "          BASE_SHA: ${{ github.event.pull_request.base.sha }}",
  "          HEAD_SHA: ${{ github.event.pull_request.head.sha }}",
  "          RUN_ID: ${{ github.run_id }}",
  "        run: |",
  "          node .github/scripts/clossys-collect-adoption-snapshot.mjs \\",
  "            .starter/request.json \\",
  '            "$RUNNER_TEMP/adoption-snapshot"',
  "",
  "      - name: Upload the snapshot",
  `        uses: ${UPLOAD_ARTIFACT}`,
  "        with:",
  "          name: adoption-snapshot-${{ github.run_id }}",
  "          path: ${{ runner.temp }}/adoption-snapshot",
  "          if-no-files-found: error",
  "          retention-days: 7",
  "",
].join("\n");

/** The bytes of `.github/workflows/clossys-adoption-evidence.yml`. */
export function renderAdoptionEvidenceWorkflow(): string {
  return ADOPTION_EVIDENCE_WORKFLOW;
}

// ---------------------------------------------------------------------------
// The path-scope script and workflow
// ---------------------------------------------------------------------------

const PATH_SCOPE_SCRIPT = String.raw`// Clossys path scope.
//
// Fails a Clossys apply pull request that changes a file Clossys does not own,
// or an owned file the pull request's own ledger does not name. It reads git
// only: git diff and git show, run without a shell. It never runs, loads or
// evaluates anything from the checked-out files.
//
// Inputs come from the environment only: HEAD_REF (the pull request head
// branch), BASE_SHA and HEAD_SHA (40 lowercase hex commits). Exit codes: 0
// passed (or not an apply pull request), 1 findings, 2 could not check. Every
// doubt is a 2.
${PATH_SCOPE_IMPORTS}

const APPLY_PREFIX = "clossys/apply-";
const LEDGER_PATH = "clossys/.state/installed.json";
const EXEMPT = new Set([LEDGER_PATH, "package-lock.json", "pnpm-lock.yaml", "package.json"]);
const OWNED = ${JSON.stringify(OWNED_PATH_PATTERNS, null, 2)};
const MAX_PRINTED = 50;
const MAX_BUFFER = 64 * 1024 * 1024;
const COMMIT = /^[0-9a-f]{40}$/;
const DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// matcher:begin
const SAFE_PATH = /^(?:(?!\.\.?\/)[^/\\\u0000-\u001f]+\/)*(?!\.\.?$)[^/\\\u0000-\u001f]+$/u;

function isSafePath(path) {
  return SAFE_PATH.test(path);
}

function isPattern(pattern) {
  if (pattern === "**" || !isSafePath(pattern)) return false;
  return pattern.split("/").every((segment) => segment === "**" || !segment.includes("**"));
}

function segmentMatches(segment, glob) {
  const source = glob.split("*").map((part) => part.replace(/[.+?^$\{}()|[\]\\]/g, "\\$&")).join("[^/]*");
  return new RegExp("^" + source + "$", "u").test(segment);
}

function segmentsMatch(path, pattern) {
  if (pattern.length === 0) return path.length === 0;
  const head = pattern[0];
  const rest = pattern.slice(1);
  if (head === "**") {
    for (let skip = 0; skip <= path.length; skip += 1) if (segmentsMatch(path.slice(skip), rest)) return true;
    return false;
  }
  return path.length > 0 && segmentMatches(path[0], head) && segmentsMatch(path.slice(1), rest);
}

function matches(path, pattern) {
  if (!isSafePath(path) || !isPattern(pattern)) return false;
  return segmentsMatch(path.split("/"), pattern.split("/"));
}
// matcher:end

class Refusal extends Error {}

function refuse(message) {
  throw new Refusal(message);
}

function clean(text) {
  return String(text).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "?").slice(0, 300);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function gitOutput(args, what) {
  try {
    return execFileSync("git", args, { maxBuffer: MAX_BUFFER, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return refuse(what + " failed");
  }
}

function decode(buffer, what) {
  try {
    return DECODER.decode(buffer);
  } catch {
    return refuse(what + " is not valid UTF-8");
  }
}

function changedPaths(baseSha, headSha) {
  const output = gitOutput(
    ["diff", "--name-only", "-z", "--no-renames", "--no-ext-diff", "--diff-filter=ACDMRTUXB", baseSha + "..." + headSha],
    "git diff",
  );
  const parts = decode(output, "the changed path list").split("\u0000");
  if (parts.pop() !== "") refuse("the changed path list is not NUL-terminated");
  return parts;
}

function namedPaths(headSha) {
  const text = decode(gitOutput(["show", "--no-textconv", headSha + ":" + LEDGER_PATH], "reading the head ledger"), "the head ledger");
  let ledger;
  try {
    ledger = JSON.parse(text);
  } catch {
    return refuse("the head ledger is not valid JSON");
  }
  if (!isRecord(ledger) || !Array.isArray(ledger.files)) refuse("the head ledger has no files array");
  const named = new Set();
  for (const row of ledger.files) {
    if (!isRecord(row) || typeof row.path !== "string") refuse("a row in the head ledger's files has no string path");
    named.add(row.path);
  }
  for (const member of ["entries", "keys"]) {
    if (!Object.hasOwn(ledger, member)) continue;
    if (!Array.isArray(ledger[member])) refuse("the head ledger's " + member + " is not an array");
    for (const row of ledger[member]) {
      if (!isRecord(row) || typeof row.file !== "string") refuse("a row in the head ledger's " + member + " has no string file");
      named.add(row.file);
    }
  }
  return named;
}

function main() {
  const headRef = process.env.HEAD_REF;
  if (typeof headRef !== "string" || headRef === "") refuse("HEAD_REF is not set");
  if (!headRef.startsWith(APPLY_PREFIX)) {
    console.log("path-scope: not a Clossys apply pull request (the head branch does not start with " + APPLY_PREFIX + "); nothing to check");
    return 0;
  }
  const baseSha = process.env.BASE_SHA;
  const headSha = process.env.HEAD_SHA;
  if (typeof baseSha !== "string" || !COMMIT.test(baseSha)) refuse("BASE_SHA is not a 40-character lowercase hex commit");
  if (typeof headSha !== "string" || !COMMIT.test(headSha)) refuse("HEAD_SHA is not a 40-character lowercase hex commit");

  const changed = changedPaths(baseSha, headSha);
  const named = namedPaths(headSha);
  const findings = [];
  for (const path of changed) {
    if (!OWNED.some((pattern) => matches(path, pattern))) findings.push("outside-owned-scope: " + clean(path));
    if (!EXEMPT.has(path) && !named.has(path)) findings.push("not-named-by-ledger: " + clean(path));
  }
  if (findings.length === 0) {
    console.log("path-scope: " + changed.length + " path(s) checked");
    return 0;
  }
  for (const finding of findings.slice(0, MAX_PRINTED)) console.error(finding);
  const shown = Math.min(findings.length, MAX_PRINTED);
  console.error("path-scope: " + findings.length + " finding(s) in " + changed.length + " changed path(s)" + (shown < findings.length ? "; first " + shown + " shown" : ""));
  return 1;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error("path-scope: refused: " + (error instanceof Refusal ? error.message : "unexpected failure"));
  process.exitCode = 2;
}
`;

/**
 * The standalone path-scope script (its text ends in one LF). The
 * path-scope workflow embeds it; a test runs it with `node` directly.
 */
export function renderPathScopeScript(agentProvenance: "codex" | "claude" | "cursor" | undefined = undefined): string {
  if (agentProvenance === undefined) return PATH_SCOPE_SCRIPT;
  if (!["codex", "claude", "cursor"].includes(agentProvenance)) throw new TypeError("unsupported agent provenance");
  // Keep legacy bytes unchanged. Explicit provenance opts into the expanded
  // branch recognizer; every supported namespace still runs the full checks.
  return PATH_SCOPE_SCRIPT
    .replace('const APPLY_PREFIX = "clossys/apply-";', 'const APPLY_PREFIX = "a supported apply branch";\nconst APPLY_BRANCH = /^(clossys|codex|claude|cursor)\\/apply-[0-9a-f]{12}$/;')
    .replace('if (!headRef.startsWith(APPLY_PREFIX)) {', 'if (!APPLY_BRANCH.test(headRef)) {\n    if (headRef.includes("/apply")) refuse("unsupported or malformed apply branch");');
}

const PATH_SCOPE_WORKFLOW_HEAD = [
  "# Clossys path scope, written by Clossys Launcher.",
  "#",
  "# This applies to pull requests whose head branch starts with clossys/apply-.",
  "# For those it lists every file the pull request changes, deletions included,",
  "# and fails unless each one matches a path Clossys may own and, apart from the",
  "# ledger, package.json and the lockfiles, is named by the pull request's own",
  "# clossys/.state/installed.json. Any other pull request passes with a notice.",
  "# That decision is made inside the script, not by a job condition, so this job",
  "# and its check always run.",
  "#",
  "# This workflow runs in the pull request's own context, so a pull request can",
  "# edit it. It catches an agent's mistakes, not a hostile author. The trusted",
  "# admission job is the separate workflow_run workflow, which runs from the",
  "# protected base.",
  "#",
  "# The script only runs git diff and git show. It never runs, loads or evaluates",
  "# anything from the checked-out files, and the branch name reaches it only",
  "# through the environment.",
  "name: Clossys path scope",
  "",
  "on:",
  "  pull_request:",
  "    types: [opened, synchronize, reopened]",
  "",
  "permissions:",
  "  contents: read",
  "",
  "jobs:",
  "  path-scope:",
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 10",
  "    steps:",
  "      - name: Check out the pull request head",
  `        uses: ${CHECKOUT}`,
  "        with:",
  "          ref: ${{ github.event.pull_request.head.sha }}",
  "          fetch-depth: 0",
  "          persist-credentials: false",
  "",
  "      # The branch name and both commits reach the script only through the",
  "      # environment, never through its text.",
  "      - name: Check the changed paths",
  "        env:",
  "          HEAD_REF: ${{ github.event.pull_request.head.ref }}",
  "          BASE_SHA: ${{ github.event.pull_request.base.sha }}",
  "          HEAD_SHA: ${{ github.event.pull_request.head.sha }}",
  "        run: |",
  `          node --input-type=module - <<'${HEREDOC_TERMINATOR}'`,
];

const RUN_BODY_INDENT = "          ";

/** The bytes of `.github/workflows/clossys-path-scope.yml`: the script embedded in a quoted heredoc. */
export function renderPathScopeWorkflow(agentProvenance: "codex" | "claude" | "cursor" | undefined = undefined): string {
  const body = renderPathScopeScript(agentProvenance).slice(0, -1)
    .split("\n")
    .map((line) => (line === "" ? "" : `${RUN_BODY_INDENT}${line}`));
  const head = agentProvenance === undefined ? PATH_SCOPE_WORKFLOW_HEAD : PATH_SCOPE_WORKFLOW_HEAD.map((line) => line.replace("head branch starts with clossys/apply-.", "head branch is a legacy or supported agent apply branch."));
  return [...head, ...body, `${RUN_BODY_INDENT}${HEREDOC_TERMINATOR}`, ""].join("\n");
}
