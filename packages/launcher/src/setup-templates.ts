/*
 * The bytes of the setup template files: the Starter request, the trusted
 * adoption decision workflow, the product CI workflow, and the dispatcher that
 * names which files an act writes.
 *
 * These are pure renderers. They do no I/O and read no clock, environment, or
 * randomness, so the bytes are a function of the input and of the constants
 * below. The only imports are the act-to-path table and the sibling script
 * renderers, which are themselves pure. Every ambiguity refuses: a refusal names
 * a position (`starter.version`), never the offending value, so a refusal can be
 * shown or logged without carrying what was refused.
 *
 * Template text is built only from the string constants below. The one choice
 * an input makes is between the two constant install variants; no caller text
 * is ever spliced into a workflow.
 */

import { TEMPLATE_PATHS, type TemplateAct } from "./change-set-contract.js";
import { renderAdoptionEvidenceWorkflow, renderPathScopeWorkflow, renderSnapshotCollector } from "./setup-template-scripts.js";

export type SetupPackageManager = "npm" | "pnpm";

export interface StarterPinInput {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
}

export interface StarterRequestInput {
  readonly packageManager: unknown;
  readonly repository: string;
  readonly starter: StarterPinInput;
}

export interface TemplateRefusal {
  readonly reason: "starter-pin-unsupported" | "package-manager-unsupported" | "input-invalid";
  /** A position such as `starter.version`. Never the offending value. */
  readonly at: string;
}

export interface TemplateFile {
  readonly path: string;
  readonly bytes: string;
}

export type TemplateResult =
  | { readonly ok: true; readonly files: readonly TemplateFile[] }
  | { readonly ok: false; readonly refusal: TemplateRefusal };

/**
 * The Starter versions a setup may pin, for documentation. The check below is
 * the rule: an exact `0.2.PATCH`, with no range, prerelease, build metadata, or
 * leading zero.
 */
export const STARTER_PIN_RANGE = ">=0.2.0 <0.3.0";

const REQUEST_PATH = ".starter/request.json";
const DECISION_WORKFLOW_PATH = ".github/workflows/clossys-adoption-decision.yml";

const STARTER_NAME = "@clossys/starter";
const STARTER_BIN = "foundry-starter";
const SNAPSHOT_MAX_AGE_MS = 3_600_000;

const STARTER_VERSION = /^0\.2\.(?:0|[1-9][0-9]{0,8})$/u;
/** A SHA-512 SRI: 86 base64 symbols and `==`. */
const SHA512_SRI = /^sha512-([A-Za-z0-9+/]{86})==$/u;
/** The last of 86 symbols carries 4 payload bits and 2 zero bits; only these four symbols end a canonical 64-byte value. */
const CANONICAL_LAST_SYMBOL = "AQgw";
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
const REPOSITORY_NAME = /^[A-Za-z0-9._-]{1,100}$/u;

const INPUT_KEYS: ReadonlySet<string> = new Set(["packageManager", "repository", "starter"]);
const STARTER_KEYS: ReadonlySet<string> = new Set(["name", "version", "integrity"]);

function refuse(reason: TemplateRefusal["reason"], at: string): TemplateResult {
  return { ok: false, refusal: { reason, at } };
}

/**
 * Whether `value` is a plain object: an ordinary or null-prototype object whose
 * every own key is a string in `allowed`, spelled as an enumerable data
 * property. A getter, a symbol key, or a key named anything else (an inherited
 * shape, `__proto__` from a JSON parse) is not plain.
 */
function isPlainRecord(value: unknown, allowed: ReadonlySet<string>): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return false;
  }
  return true;
}

function ownValue(record: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(record, key)?.value;
}

function isPackageManager(value: unknown): value is SetupPackageManager {
  return value === "npm" || value === "pnpm";
}

function isRepositorySlug(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split("/");
  if (parts.length !== 2) return false;
  const [owner, name] = parts as [string, string];
  return OWNER.test(owner) && REPOSITORY_NAME.test(name) && name !== "." && name !== "..";
}

function isSha512Sri(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = SHA512_SRI.exec(value);
  if (match === null) return false;
  return CANONICAL_LAST_SYMBOL.includes((match[1] as string).charAt(85));
}

/** Render `.starter/request.json`, or refuse at the first position, in the fixed order, that is not acceptable. */
export function renderStarterRequest(input: unknown): TemplateResult {
  if (!isPlainRecord(input, INPUT_KEYS)) return refuse("input-invalid", "input");
  const packageManager = ownValue(input, "packageManager");
  const repository = ownValue(input, "repository");
  const starter = ownValue(input, "starter");
  if (!isPlainRecord(starter, STARTER_KEYS)) return refuse("input-invalid", "starter");

  if (!isPackageManager(packageManager)) return refuse("package-manager-unsupported", "packageManager");
  if (!isRepositorySlug(repository)) return refuse("input-invalid", "repository");
  const name = ownValue(starter, "name");
  if (name !== STARTER_NAME) return refuse("input-invalid", "starter.name");
  const version = ownValue(starter, "version");
  if (typeof version !== "string" || !STARTER_VERSION.test(version)) return refuse("starter-pin-unsupported", "starter.version");
  const integrity = ownValue(starter, "integrity");
  if (!isSha512Sri(integrity)) return refuse("input-invalid", "starter.integrity");

  // Every member is written out, in this order, from the checked values above.
  // The request never carries an advisor or a hub.
  const request = {
    schemaVersion: 1,
    phase: "admission",
    packageManager,
    snapshot: {
      repository,
      maxAgeMs: SNAPSHOT_MAX_AGE_MS,
    },
    starter: {
      name,
      version,
      integrity,
      bin: STARTER_BIN,
    },
    target: {
      name,
      version,
      integrity,
      bin: STARTER_BIN,
      invocation: "single-json-input",
    },
    evidence: {
      assessment: "evidence/assessment.json",
      targetInput: "evidence/target-input.json",
    },
  };
  return { ok: true, files: [{ path: REQUEST_PATH, bytes: `${JSON.stringify(request, null, 2)}\n` }] };
}

// ---------------------------------------------------------------------------
// The trusted adoption decision workflow
// ---------------------------------------------------------------------------

const CHECKOUT = "actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0";
const SETUP_NODE = "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0";

const HEADER: readonly string[] = [
  "# Clossys adoption decision, written by Clossys Launcher.",
  "#",
  "# This is the trusted half of the adoption check. It runs when the",
  '# "Clossys adoption evidence" workflow completes, whatever its conclusion,',
  "# and its job has no condition: a skipped required job reads as a green check,",
  "# so this job starts for every conclusion.",
  "#",
  "# The trusted job executes only the installed base. It checks out the pull",
  "# request base commit, runs one fixed frozen install with lifecycle scripts",
  "# off and no registry credential, and runs the installed Starter's admit",
  "# command. It reads the pull request head's installed ledger as data, from a",
  "# sparse checkout of that one file, and executes nothing from the head.",
  "#",
  "# The snapshot artifact a pull request produces is never read by this job. No",
  "# artifact of any kind is fetched or trusted here.",
  "#",
  "# One-merge lag: this job runs from the base, so a change to this workflow, to",
  "# the evidence workflow, or to .starter/request.json is proved only by the",
  "# first pull request after it merges.",
];

function workflowTop(manager: SetupPackageManager): readonly string[] {
  return [
    ...HEADER,
    "name: Clossys adoption decision (" + manager + ")",
    "",
    "on:",
    "  workflow_run:",
    "    workflows: [Clossys adoption evidence]",
    "    types: [completed]",
    "",
    "permissions:",
    "  contents: read",
    "",
    "jobs:",
    "  decide-adoption:",
    "    runs-on: ubuntu-latest",
    "    timeout-minutes: 15",
    "    steps:",
  ];
}

const FIRST_STEPS: readonly string[] = [
  "      # Fail closed unless this run names a pull request base and a head commit.",
  "      # A run with no pull request, such as one from a fork, has neither. Values",
  "      # reach the script only through the environment, never through its text.",
  "      - name: Require the pull request base and head",
  "        env:",
  "          BASE_SHA: ${{ github.event.workflow_run.pull_requests[0].base.sha }}",
  "          HEAD_SHA: ${{ github.event.workflow_run.head_sha }}",
  "        run: |",
  "          sha='^[0-9a-f]{40}$'",
  '          if [[ ! "$BASE_SHA" =~ $sha || ! "$HEAD_SHA" =~ $sha ]]; then',
  '            echo "::error::This run has no pull request base and head commit to admit."',
  "            exit 1",
  "          fi",
  "",
  "      # The protected pull request base, never the source run's head. It is the",
  "      # only checkout this job executes.",
  "      - name: Check out the protected base",
  "        uses: " + CHECKOUT,
  "        with:",
  "          ref: ${{ github.event.workflow_run.pull_requests[0].base.sha }}",
  "          persist-credentials: false",
  "",
  "      - name: Set up Node",
  "        uses: " + SETUP_NODE,
  "        with:",
  "          node-version: 20",
  "          registry-url: https://registry.npmjs.org",
  '          scope: "@clossys"',
  "",
];

const NPM_INSTALL: readonly string[] = [
  "      # Fixed and frozen: lifecycle scripts stay off and no registry credential is",
  "      # attached. A failure here stops the job before Starter runs.",
  "      - name: Fixed npm install",
  "        run: npm ci --ignore-scripts",
];

const PNPM_INSTALL: readonly string[] = [
  "      - name: Enable pnpm",
  "        run: corepack enable",
  "",
  "      # Fixed and frozen: lifecycle scripts stay off and no registry credential is",
  "      # attached. A failure here stops the job before Starter runs.",
  "      - name: Fixed pnpm install",
  "        run: pnpm install --frozen-lockfile --ignore-scripts",
];

const LAST_STEPS: readonly string[] = [
  "",
  "      # The pull request head as data only: one file, no persisted credential,",
  "      # nothing executed.",
  "      - name: Check out the pull request head ledger as data",
  "        uses: " + CHECKOUT,
  "        with:",
  "          ref: ${{ github.event.workflow_run.head_sha }}",
  "          path: .starter-head",
  "          persist-credentials: false",
  "          sparse-checkout-cone-mode: false",
  "          sparse-checkout: |",
  "            /clossys/.state/installed.json",
  "",
  "      # No credential environment is attached to this step. Its captured status",
  "      # is printed and re-raised exactly.",
  "      - name: Admit the pull request head",
  "        run: |",
  '          report="$RUNNER_TEMP/adoption-admission-report.json"',
  '          output="$RUNNER_TEMP/adoption-admission.txt"',
  "          status=0",
  "          node node_modules/@clossys/starter/dist/cli.js admit \\",
  "            .starter/request.json \\",
  "            . \\",
  "            .starter-head \\",
  '            --report "$report" > "$output" || status=$?',
  '          cat "$output"',
  '          cat "$output" >> "$GITHUB_STEP_SUMMARY"',
  '          exit "$status"',
  "",
];

function decisionWorkflow(manager: SetupPackageManager): string {
  const install = manager === "npm" ? NPM_INSTALL : PNPM_INSTALL;
  return [...workflowTop(manager), ...FIRST_STEPS, ...install, ...LAST_STEPS].join("\n");
}

/** Render `.github/workflows/clossys-adoption-decision.yml` for npm or pnpm, or refuse at `packageManager`. */
export function renderAdoptionDecisionWorkflow(packageManager: unknown): TemplateResult {
  if (!isPackageManager(packageManager)) return refuse("package-manager-unsupported", "packageManager");
  return { ok: true, files: [{ path: DECISION_WORKFLOW_PATH, bytes: decisionWorkflow(packageManager) }] };
}

// ---------------------------------------------------------------------------
// The product CI workflow
// ---------------------------------------------------------------------------

const CI_WORKFLOW_PATH = ".github/workflows/clossys-ci.yml";
const PATH_SCOPE_WORKFLOW_PATH = ".github/workflows/clossys-path-scope.yml";
const EVIDENCE_WORKFLOW_PATH = ".github/workflows/clossys-adoption-evidence.yml";
const SNAPSHOT_COLLECTOR_PATH = ".github/scripts/clossys-collect-adoption-snapshot.mjs";

/**
 * The lines of the product CI workflow, one string per line. The workflow
 * carries `${{` expressions, which is why these are quoted strings and not a
 * template literal. A test holds these bytes equal to the copy Controller ships.
 */
const PRODUCT_CI_WORKFLOW: readonly string[] = [
  "# CI workflow for a client product repository. The setup pull request of a",
  "# product repository writes this file as .github/workflows/clossys-ci.yml,",
  "# only when that path is absent -- an existing file is left as the",
  "# repository has it.",
  "#",
  "# Passes ci-conventions-check with `verify-product` declared as the required",
  "# context mapped to that installed path; a test in this package runs the",
  "# shipped bytes through the checker. One job means no fan-in job is needed:",
  "# `verify-product` is itself the required-status-check context.",
  "#",
  "# The package manager is chosen by lockfile, and anything else fails",
  "# closed: a repository with exactly one of package-lock.json or",
  "# pnpm-lock.yaml installs with that manager, and a repository with both, with",
  "# neither, or with a yarn.lock beside either is refused by the install step",
  "# with an error rather than guessed at. The install step",
  "# passes --ignore-scripts, and no cache is configured because cache selection",
  "# would need the same lockfile decision made before the install step runs.",
  "# Build and test run the repository's own `build` and `test` scripts when",
  "# present and skip a missing one.",
  "",
  "name: Clossys CI",
  "",
  "on:",
  "  pull_request:",
  "  push:",
  "    branches: [main]",
  "  merge_group:",
  "",
  "# Least-privilege by default (ci-conventions.md, Security). A job that",
  "# genuinely needs more declares exactly that job-level exception.",
  "permissions:",
  "  contents: read",
  "",
  "# cancel-in-progress only for pull_request: the group key includes the",
  "# event name, so a push (to main) or a merge_group run is never cancelled",
  "# by a later pull_request run on the same ref, and a pull_request run IS",
  "# cancelled by its own next push -- ci-conventions.md, Cost.",
  "concurrency:",
  "  group: ci-${{ github.workflow }}-${{ github.event_name }}-${{ github.ref }}",
  "  cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
  "",
  "jobs:",
  "  verify-product:",
  "    runs-on: ubuntu-latest",
  "    timeout-minutes: 15",
  "    steps:",
  "      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0",
  "        with:",
  "          persist-credentials: false",
  "      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0",
  "        with:",
  "          node-version: 20",
  "      # Selects the manager once and records it as PM for the build and",
  "      # test steps below, so the lockfile decision is not repeated.",
  "      - name: Install dependencies",
  "        run: |",
  "          if [ -f yarn.lock ]; then",
  "            echo \"::error::yarn.lock is present and Yarn is not supported\"",
  "            exit 1",
  "          elif [ -f pnpm-lock.yaml ] && [ ! -f package-lock.json ]; then",
  "            echo \"PM=pnpm\" >> \"$GITHUB_ENV\"",
  "            corepack enable",
  "            pnpm install --frozen-lockfile --ignore-scripts",
  "          elif [ -f package-lock.json ] && [ ! -f pnpm-lock.yaml ]; then",
  "            echo \"PM=npm\" >> \"$GITHUB_ENV\"",
  "            npm ci --ignore-scripts",
  "          else",
  "            echo \"::error::exactly one of package-lock.json or pnpm-lock.yaml is required\"",
  "            exit 1",
  "          fi",
  "      - name: Build",
  "        run: '\"${PM:?}\" run --if-present build'",
  "      - name: Test",
  "        run: '\"${PM:?}\" run --if-present test'",
];

/** Render `.github/workflows/clossys-ci.yml`. */
export function renderProductCiWorkflow(): string {
  return `${PRODUCT_CI_WORKFLOW.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// The dispatcher
// ---------------------------------------------------------------------------

const CALLER_KEYS: ReadonlySet<string> = new Set(["packageManager"]);

function isTemplateAct(value: unknown): value is TemplateAct {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TEMPLATE_PATHS, value);
}

/** Hand back `files` only when their paths are exactly the act's, in order; anything else is a refusal. */
function checked(act: TemplateAct, result: TemplateResult): TemplateResult {
  if (!result.ok) return result;
  const expected = TEMPLATE_PATHS[act];
  const same = result.files.length === expected.length && result.files.every((file, index) => file.path === expected[index]);
  return same ? result : refuse("input-invalid", "act");
}

function renderCallerWorkflows(input: unknown): TemplateResult {
  if (!isPlainRecord(input, CALLER_KEYS) || Reflect.ownKeys(input).length !== 1) return refuse("input-invalid", "input");
  const decision = renderAdoptionDecisionWorkflow(ownValue(input, "packageManager"));
  if (!decision.ok) return decision;
  return {
    ok: true,
    files: [
      { path: EVIDENCE_WORKFLOW_PATH, bytes: renderAdoptionEvidenceWorkflow() },
      ...decision.files,
      { path: SNAPSHOT_COLLECTOR_PATH, bytes: renderSnapshotCollector() },
    ],
  };
}

function renderFixedFile(input: unknown, path: string, bytes: () => string): TemplateResult {
  if (input !== undefined) return refuse("input-invalid", "input");
  return { ok: true, files: [{ path, bytes: bytes() }] };
}

/**
 * Render the files one setup act writes, or refuse. `add-caller-workflow` takes
 * `{ packageManager }`, `write-starter-request` takes a `StarterRequestInput`,
 * and `add-ci-template` and `add-path-scope-job` take no input. The returned
 * paths are always `TEMPLATE_PATHS[act]`, in that order.
 */
export function renderSetupTemplate(act: TemplateAct, input?: unknown): TemplateResult {
  const name: unknown = act;
  if (!isTemplateAct(name)) return refuse("input-invalid", "act");
  switch (name) {
    case "add-caller-workflow":
      return checked(name, renderCallerWorkflows(input));
    case "write-starter-request":
      return checked(name, renderStarterRequest(input));
    case "add-ci-template":
      return checked(name, renderFixedFile(input, CI_WORKFLOW_PATH, renderProductCiWorkflow));
    case "add-path-scope-job":
      return checked(name, renderFixedFile(input, PATH_SCOPE_WORKFLOW_PATH, renderPathScopeWorkflow));
  }
}
