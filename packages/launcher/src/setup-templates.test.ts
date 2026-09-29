import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// Controller's own source in this repository, read by this test only. Launcher
// has no runtime dependency on Controller and the renderers import none of it.
import { evaluateCiConventions } from "../../controller/src/conventions/ci-conventions.js";
import { parseYamlLite } from "../../controller/src/conventions/yaml-lite.js";
import { TEMPLATE_PATHS, type TemplateAct } from "./change-set-contract.js";
import { renderAdoptionEvidenceWorkflow, renderPathScopeWorkflow, renderSnapshotCollector } from "./setup-template-scripts.js";
import {
  STARTER_PIN_RANGE,
  renderAdoptionDecisionWorkflow,
  renderProductCiWorkflow,
  renderSetupTemplate,
  renderStarterRequest,
  type TemplateResult,
} from "./setup-templates.js";

const INTEGRITY = `sha512-${"a".repeat(85)}A==`;
const pin = (overrides: Record<string, unknown> = {}) => ({ name: "@clossys/starter", version: "0.2.1", integrity: INTEGRITY, ...overrides });
const input = (overrides: Record<string, unknown> = {}) => ({ packageManager: "npm", repository: "acme/widgets", starter: pin(), ...overrides });

function files(result: TemplateResult) {
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.refusal)}`);
  return result.files;
}
function refusal(result: TemplateResult) {
  if (result.ok) throw new Error("expected a refusal");
  return result.refusal;
}

const expectedRequest = (packageManager: string) =>
  [
    "{",
    '  "schemaVersion": 1,',
    '  "phase": "admission",',
    `  "packageManager": "${packageManager}",`,
    '  "snapshot": {',
    '    "repository": "acme/widgets",',
    '    "maxAgeMs": 3600000',
    "  },",
    '  "starter": {',
    '    "name": "@clossys/starter",',
    '    "version": "0.2.1",',
    `    "integrity": "${INTEGRITY}",`,
    '    "bin": "foundry-starter"',
    "  },",
    '  "target": {',
    '    "name": "@clossys/starter",',
    '    "version": "0.2.1",',
    `    "integrity": "${INTEGRITY}",`,
    '    "bin": "foundry-starter",',
    '    "invocation": "single-json-input"',
    "  },",
    '  "evidence": {',
    '    "assessment": "evidence/assessment.json",',
    '    "targetInput": "evidence/target-input.json"',
    "  }",
    "}",
    "",
  ].join("\n");

describe("renderStarterRequest", () => {
  it("names the documented pin range", () => {
    expect(STARTER_PIN_RANGE).toBe(">=0.2.0 <0.3.0");
  });

  it.each(["npm", "pnpm"] as const)("writes byte-exact 2-space JSON with a final newline for %s", (packageManager) => {
    const out = files(renderStarterRequest(input({ packageManager })));
    expect(out).toHaveLength(1);
    expect(out[0]!.path).toBe(".starter/request.json");
    expect(out[0]!.bytes).toBe(expectedRequest(packageManager));
  });

  it("orders keys exactly and carries no advisor and no hub", () => {
    const parsed = JSON.parse(files(renderStarterRequest(input()))[0]!.bytes) as Record<string, Record<string, unknown> | unknown>;
    expect(Object.keys(parsed)).toEqual(["schemaVersion", "phase", "packageManager", "snapshot", "starter", "target", "evidence"]);
    expect("advisor" in parsed).toBe(false);
    expect("hub" in parsed).toBe(false);
    expect(parsed.phase).toBe("admission");
    expect(Object.keys(parsed.snapshot as object)).toEqual(["repository", "maxAgeMs"]);
    expect(Object.keys(parsed.starter as object)).toEqual(["name", "version", "integrity", "bin"]);
    expect(Object.keys(parsed.target as object)).toEqual(["name", "version", "integrity", "bin", "invocation"]);
    expect(parsed.target).toEqual({ ...(parsed.starter as object), invocation: "single-json-input" });
    expect(parsed.evidence).toEqual({ assessment: "evidence/assessment.json", targetInput: "evidence/target-input.json" });
  });

  it("accepts 0.2.0 and 0.2.7 and refuses every other version shape at starter.version", () => {
    for (const version of ["0.2.0", "0.2.7", "0.2.10", "0.2.999"]) expect(renderStarterRequest(input({ starter: pin({ version }) })).ok, version).toBe(true);
    for (const version of ["0.1.9", "0.3.0", "0.2.0-rc.1", "1.0.0", "0.2", "v0.2.1", "0.2.01", "0.02.1", "00.2.1", "0.2.1+build", "0.2.1\n", " 0.2.1", "0.2.1 ", "0.2.x", "^0.2.0", ">=0.2.0 <0.3.0", "", "0.2.1.0", "0.2.9999999999999", 2, null, undefined, {}]) {
      expect(refusal(renderStarterRequest(input({ starter: pin({ version }) })), ), String(version)).toEqual({ reason: "starter-pin-unsupported", at: "starter.version" });
    }
  });

  it("refuses an unsupported package manager at packageManager", () => {
    for (const packageManager of ["yarn", "Yarn", undefined, "npm ", "NPM", "pnpm\n", "", null, 1, ["npm"], { toString: () => "npm" }]) {
      expect(refusal(renderStarterRequest(input({ packageManager }))), String(packageManager)).toEqual({ reason: "package-manager-unsupported", at: "packageManager" });
    }
    const missing: Record<string, unknown> = input();
    delete missing.packageManager;
    expect(refusal(renderStarterRequest(missing))).toEqual({ reason: "package-manager-unsupported", at: "packageManager" });
  });

  it("refuses a wrong starter name at starter.name", () => {
    for (const name of ["@clossys/advisor", "@clossys/starter ", "@Clossys/starter", "clossys/starter", "", undefined, 3]) {
      expect(refusal(renderStarterRequest(input({ starter: pin({ name }) }))), String(name)).toEqual({ reason: "input-invalid", at: "starter.name" });
    }
  });

  it("refuses a bad integrity at starter.integrity", () => {
    const bad = [
      `sha512-${"a".repeat(84)}A==`, // wrong length
      `sha512-${"a".repeat(86)}A==`,
      `sha256-${"a".repeat(85)}A==`, // wrong algorithm
      `sha1-${"a".repeat(85)}A==`,
      `${"a".repeat(85)}A==`, // no prefix
      `sha512-${"a".repeat(85)}B==`, // non-canonical trailing bits
      `sha512-${"a".repeat(85)}A=`, // padding
      `sha512-${"a".repeat(85)}A`,
      `sha512-${"a".repeat(85)}A==\n`,
      ` sha512-${"a".repeat(85)}A==`,
      `sha512-${"a".repeat(85)}-==`, // url alphabet
      `sha512-${"a".repeat(85)}A== sha256-${"a".repeat(43)}=`, // two hashes
      "",
      42,
      undefined,
      null,
    ];
    for (const integrity of bad) expect(refusal(renderStarterRequest(input({ starter: pin({ integrity }) }))), String(integrity)).toEqual({ reason: "input-invalid", at: "starter.integrity" });
    for (const last of ["A", "Q", "g", "w"]) expect(renderStarterRequest(input({ starter: pin({ integrity: `sha512-${"b".repeat(85)}${last}==` }) })).ok, last).toBe(true);
    for (const last of ["B", "R", "h", "x", "+", "/", "0"]) expect(renderStarterRequest(input({ starter: pin({ integrity: `sha512-${"b".repeat(85)}${last}==` }) })).ok, last).toBe(false);
  });

  it("refuses a bad repository at repository", () => {
    for (const repository of ["widgets", "acme/", "/widgets", "acme/widgets/extra", "acme/.", "acme/..", "-acme/widgets", "acme-/widgets", "ac me/widgets", "acme/wid gets", "acme/widgets\n", "https://github.com/acme/widgets", "acme\\widgets", "acme/wid?gets", "", `${"a".repeat(40)}/widgets`, `acme/${"w".repeat(101)}`, 5, null, undefined, ["acme/widgets"]]) {
      expect(refusal(renderStarterRequest(input({ repository }))), String(repository)).toEqual({ reason: "input-invalid", at: "repository" });
    }
    for (const repository of ["acme/widgets", "a/b", "Acme-Co/my.repo_1", "acme/.github", "acme/..x", "a1/b-2"]) expect(renderStarterRequest(input({ repository })).ok, repository).toBe(true);
  });

  it("refuses input that is not a plain object or carries unknown keys", () => {
    for (const bad of [null, undefined, [], [input()], "npm", 3, true]) {
      expect(refusal(renderStarterRequest(bad)), String(bad)).toEqual({ reason: "input-invalid", at: "input" });
    }
    expect(refusal(renderStarterRequest({ ...input(), advisor: {} }))).toEqual({ reason: "input-invalid", at: "input" });
    expect(refusal(renderStarterRequest({ ...input(), hub: {} }))).toEqual({ reason: "input-invalid", at: "input" });
    expect(refusal(renderStarterRequest(Object.assign(Object.create({ inherited: 1 }), input())))).toEqual({ reason: "input-invalid", at: "input" });
    expect(refusal(renderStarterRequest({ ...input(), [Symbol("x")]: 1 }))).toEqual({ reason: "input-invalid", at: "input" });
    const getter = input();
    Object.defineProperty(getter, "repository", { get: () => "acme/widgets", enumerable: true });
    expect(refusal(renderStarterRequest(getter))).toEqual({ reason: "input-invalid", at: "input" });
    expect(refusal(renderStarterRequest({ packageManager: "npm", repository: "acme/widgets" }))).toEqual({ reason: "input-invalid", at: "starter" });
    for (const starter of [null, [], "x", 1, { ...pin(), bin: "foundry-starter" }, { ...pin(), extra: 1 }]) {
      expect(refusal(renderStarterRequest(input({ starter }))), JSON.stringify(starter)).toEqual({ reason: "input-invalid", at: "starter" });
    }
  });

  it("refuses prototype-pollution shaped input parsed from JSON", () => {
    const top = JSON.parse(`{"packageManager":"npm","repository":"acme/widgets","starter":${JSON.stringify(pin())},"__proto__":{"polluted":true}}`);
    expect(refusal(renderStarterRequest(top))).toEqual({ reason: "input-invalid", at: "input" });
    const nested = JSON.parse(`{"packageManager":"npm","repository":"acme/widgets","starter":{"name":"@clossys/starter","version":"0.2.1","integrity":"${INTEGRITY}","__proto__":{"x":1}}}`);
    expect(refusal(renderStarterRequest(nested))).toEqual({ reason: "input-invalid", at: "starter" });
    const ctor = JSON.parse(`{"packageManager":"npm","repository":"acme/widgets","starter":${JSON.stringify(pin())},"constructor":{"prototype":{}}}`);
    expect(refusal(renderStarterRequest(ctor))).toEqual({ reason: "input-invalid", at: "input" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("validates in the fixed order, so the refusal is deterministic", () => {
    const allBad = { packageManager: "yarn", repository: "nope", starter: { name: "x", version: "9.9.9", integrity: "y" } };
    expect(refusal(renderStarterRequest(allBad)).at).toBe("packageManager");
    expect(refusal(renderStarterRequest({ ...allBad, packageManager: "npm" })).at).toBe("repository");
    expect(refusal(renderStarterRequest({ ...allBad, packageManager: "npm", repository: "a/b" })).at).toBe("starter.name");
    expect(refusal(renderStarterRequest({ ...allBad, packageManager: "npm", repository: "a/b", starter: { ...allBad.starter, name: "@clossys/starter" } })).at).toBe("starter.version");
    expect(refusal(renderStarterRequest({ ...allBad, packageManager: "npm", repository: "a/b", starter: { ...allBad.starter, name: "@clossys/starter", version: "0.2.0" } })).at).toBe("starter.integrity");
    // Shape comes before everything: unknown key on an otherwise all-bad input.
    expect(refusal(renderStarterRequest({ ...allBad, extra: 1 })).at).toBe("input");
  });

  it("never echoes the offending value in a refusal", () => {
    const marker = "MARKER-VALUE-ONE";
    const cases: unknown[] = [
      input({ packageManager: marker }),
      input({ repository: marker }),
      input({ starter: pin({ name: marker }) }),
      input({ starter: pin({ version: marker }) }),
      input({ starter: pin({ integrity: marker }) }),
      { ...input(), [marker]: 1 },
      input({ starter: { ...pin(), [marker]: 1 } }),
      marker,
    ];
    for (const value of cases) {
      const result = renderStarterRequest(value);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(marker);
    }
    expect(JSON.stringify(renderAdoptionDecisionWorkflow(marker))).not.toContain(marker);
  });

  it("is a pure function of its input", () => {
    expect(renderStarterRequest(input())).toEqual(renderStarterRequest(input()));
    expect(files(renderStarterRequest(input()))[0]!.bytes).toBe(files(renderStarterRequest(input()))[0]!.bytes);
    const frozen = Object.freeze(input({ starter: Object.freeze(pin()) }));
    expect(renderStarterRequest(frozen).ok).toBe(true);
  });
});

describe("module source", () => {
  const source = readFileSync(new URL("./setup-templates.ts", import.meta.url), "utf8");
  it("does no I/O and reads no clock, randomness, or environment", () => {
    expect(source).not.toMatch(/node:/u);
    expect(source).not.toMatch(/\bDate\b/u);
    expect(source).not.toMatch(/Math\.random/u);
    expect(source).not.toMatch(/\bprocess\./u);
    expect(source).not.toMatch(/\brequire\s*\(/u);
    expect(source).not.toMatch(/\bimport\s*\(/u);
    // The dispatcher imports the act-to-path table and the script renderers,
    // and nothing else: no built-in, no package, no dynamic import.
    expect(source.match(/^import\s.*$/gmu)).toEqual([
      'import { TEMPLATE_PATHS, type TemplateAct } from "./change-set-contract.js";',
      'import { renderAdoptionEvidenceWorkflow, renderPathScopeWorkflow, renderSnapshotCollector } from "./setup-template-scripts.js";',
    ]);
  });
});

// ---------------------------------------------------------------------------
// The decision workflow
// ---------------------------------------------------------------------------

const CHECKOUT = "actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0";
const SETUP_NODE = "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0";

const HEADER = [
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

const FIRST_STEPS = [
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
  `        uses: ${CHECKOUT}`,
  "        with:",
  "          ref: ${{ github.event.workflow_run.pull_requests[0].base.sha }}",
  "          persist-credentials: false",
  "",
  "      - name: Set up Node",
  `        uses: ${SETUP_NODE}`,
  "        with:",
  "          node-version: 20",
  "          registry-url: https://registry.npmjs.org",
  '          scope: "@clossys"',
  "",
];

const LAST_STEPS = [
  "",
  "      # The pull request head as data only: one file, no persisted credential,",
  "      # nothing executed.",
  "      - name: Check out the pull request head ledger as data",
  `        uses: ${CHECKOUT}`,
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

const TOP = (manager: string) => [
  ...HEADER,
  `name: Clossys adoption decision (${manager})`,
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

const EXPECTED_NPM = [
  ...TOP("npm"),
  ...FIRST_STEPS,
  "      # Fixed and frozen: lifecycle scripts stay off and no registry credential is",
  "      # attached. A failure here stops the job before Starter runs.",
  "      - name: Fixed npm install",
  "        run: npm ci --ignore-scripts",
  ...LAST_STEPS,
].join("\n");

const EXPECTED_PNPM = [
  ...TOP("pnpm"),
  ...FIRST_STEPS,
  "      - name: Enable pnpm",
  "        run: corepack enable",
  "",
  "      # Fixed and frozen: lifecycle scripts stay off and no registry credential is",
  "      # attached. A failure here stops the job before Starter runs.",
  "      - name: Fixed pnpm install",
  "        run: pnpm install --frozen-lockfile --ignore-scripts",
  ...LAST_STEPS,
].join("\n");

const PATH = ".github/workflows/clossys-adoption-decision.yml";

function decision(manager: string): string {
  const out = files(renderAdoptionDecisionWorkflow(manager));
  expect(out).toHaveLength(1);
  expect(out[0]!.path).toBe(PATH);
  return out[0]!.bytes;
}

describe("renderAdoptionDecisionWorkflow golden bytes", () => {
  it("writes the npm variant byte for byte", () => {
    expect(decision("npm")).toBe(EXPECTED_NPM);
  });
  it("writes the pnpm variant byte for byte", () => {
    expect(decision("pnpm")).toBe(EXPECTED_PNPM);
  });
  it("is deterministic and ends with exactly one newline", () => {
    for (const manager of ["npm", "pnpm"]) {
      expect(decision(manager)).toBe(decision(manager));
      expect(decision(manager).endsWith("\n")).toBe(true);
      expect(decision(manager).endsWith("\n\n")).toBe(false);
      expect(decision(manager)).not.toContain("\r");
      expect(decision(manager)).not.toContain("\t");
    }
  });
  it("refuses everything but npm and pnpm at packageManager", () => {
    for (const manager of ["yarn", "Yarn", "npm ", "NPM", "", undefined, null, 1, ["npm"], {}]) {
      expect(refusal(renderAdoptionDecisionWorkflow(manager)), String(manager)).toEqual({ reason: "package-manager-unsupported", at: "packageManager" });
    }
  });
});

/** The text of every `run:` body: the block scalar's lines, or the inline value. */
function runBodies(text: string): string[] {
  const lines = text.split("\n");
  const bodies: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(\s*)(?:- )?run:\s*(.*)$/u.exec(lines[i]!);
    if (match === null) continue;
    const indent = match[1]!.length;
    if (match[2] !== "|") {
      bodies.push(match[2]!);
      continue;
    }
    const body: string[] = [];
    for (let j = i + 1; j < lines.length && (lines[j] === "" || /^\s*/u.exec(lines[j]!)![0].length > indent); j += 1) body.push(lines[j]!);
    bodies.push(body.join("\n"));
  }
  return bodies;
}

describe.each(["npm", "pnpm"] as const)("decision workflow structure (%s)", (manager) => {
  const text = decision(manager);
  const parsed = parseYamlLite(text) as Record<string, any>;

  it("triggers only on the completion of the evidence workflow", () => {
    expect(Object.keys(parsed.on)).toEqual(["workflow_run"]);
    expect(parsed.on.workflow_run).toEqual({ workflows: ["Clossys adoption evidence"], types: ["completed"] });
    expect(parsed.name).toBe(`Clossys adoption decision (${manager})`);
  });

  it("holds contents: read and nothing else", () => {
    expect(parsed.permissions).toEqual({ contents: "read" });
    expect(text).not.toMatch(/actions:\s*read/u);
    expect(text.match(/^\s*permissions:/gmu)).toHaveLength(1);
  });

  it("has one job that starts for every conclusion", () => {
    expect(Object.keys(parsed.jobs)).toEqual(["decide-adoption"]);
    const job = parsed.jobs["decide-adoption"];
    expect(job["runs-on"]).toBe("ubuntu-latest");
    expect(job["timeout-minutes"]).toBe(15);
    expect(Object.keys(job)).toEqual(["runs-on", "timeout-minutes", "steps"]);
    expect(text).not.toMatch(/^\s{4}if:/mu);
    expect(text).not.toMatch(/^\s*(?:- )?if:/mu);
  });

  it("names no pull_request_target and no artifact action, anywhere", () => {
    expect(text).not.toContain("pull_request_target");
    expect(text).not.toContain("download-artifact");
    expect(text).not.toContain("upload-artifact");
    expect(text).not.toMatch(/\bgh\s+run\b|\bgh\s+api\b|\bcurl\b|\bwget\b/u);
  });

  it("pins every action to a 40-hex commit with a version comment", () => {
    const uses = text.split("\n").filter((line) => /^\s*(?:- )?uses:/u.test(line));
    expect(uses).toHaveLength(3);
    for (const line of uses) expect(line).toMatch(/uses: [a-z-]+\/[a-z-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/u);
  });

  it("checks out twice, neither persisting credentials", () => {
    expect(text.match(/actions\/checkout@/gu)).toHaveLength(2);
    expect(text.match(/^\s+persist-credentials: false$/gmu)).toHaveLength(2);
    expect(text).not.toMatch(/persist-credentials: true/u);
  });

  it("checks out the base first and the head second, as data", () => {
    const steps = parsed.jobs["decide-adoption"].steps as Record<string, any>[];
    const checkouts = steps.filter((step) => String(step.uses).startsWith("actions/checkout@"));
    expect(checkouts[0]!.with.ref).toBe("${{ github.event.workflow_run.pull_requests[0].base.sha }}");
    expect(checkouts[0]!.with.path).toBeUndefined();
    expect(checkouts[1]!.with.ref).toBe("${{ github.event.workflow_run.head_sha }}");
    expect(checkouts[1]!.with.path).toBe(".starter-head");
    expect(checkouts[1]!.with["sparse-checkout-cone-mode"]).toBe(false);
    expect(steps.indexOf(checkouts[0]!)).toBeLessThan(steps.indexOf(checkouts[1]!));
  });

  it("sparse-checks-out exactly the head ledger", () => {
    const lines = text.split("\n");
    const at = lines.findIndex((line) => line.trim() === "sparse-checkout: |");
    expect(at).toBeGreaterThan(0);
    const block: string[] = [];
    for (let i = at + 1; i < lines.length && lines[i]!.startsWith("            "); i += 1) block.push(lines[i]!.trim());
    expect(block).toEqual(["/clossys/.state/installed.json"]);
    expect(text.match(/sparse-checkout:/gu)).toHaveLength(1);
    expect(text).not.toContain("package.json");
    expect(text).not.toMatch(/\.starter\/request\.json\s*$/mu);
  });

  it("runs the steps in the specified order", () => {
    const steps = parsed.jobs["decide-adoption"].steps as Record<string, any>[];
    expect(steps.map((step) => step.name)).toEqual(
      manager === "npm"
        ? ["Require the pull request base and head", "Check out the protected base", "Set up Node", "Fixed npm install", "Check out the pull request head ledger as data", "Admit the pull request head"]
        : ["Require the pull request base and head", "Check out the protected base", "Set up Node", "Enable pnpm", "Fixed pnpm install", "Check out the pull request head ledger as data", "Admit the pull request head"],
    );
    expect(steps[0]!.env).toEqual({
      BASE_SHA: "${{ github.event.workflow_run.pull_requests[0].base.sha }}",
      HEAD_SHA: "${{ github.event.workflow_run.head_sha }}",
    });
    expect(steps[2]!.with).toEqual({ "node-version": 20, "registry-url": "https://registry.npmjs.org", scope: "@clossys" });
  });

  it("fails closed on a missing or malformed base and head, and reads them only from the environment", () => {
    const [first] = runBodies(text);
    expect(first).toContain("exit 1");
    expect(first).toContain("::error::");
    expect(first).toContain("[0-9a-f]{40}");
    expect(first).toContain("$BASE_SHA");
    expect(first).toContain("$HEAD_SHA");
  });

  it("interpolates no expression inside any run body", () => {
    const bodies = runBodies(text);
    expect(bodies.length).toBe(manager === "npm" ? 3 : 4);
    for (const body of bodies) expect(body).not.toContain("${{");
  });

  it("re-raises the admit status exactly", () => {
    expect(text).toContain('exit "$status"');
    expect(text).toContain("status=0");
    expect(text).toContain('--report "$report" > "$output" || status=$?');
    expect(text).toContain('cat "$output" >> "$GITHUB_STEP_SUMMARY"');
    expect(text).toContain("node node_modules/@clossys/starter/dist/cli.js admit");
    expect(text).not.toMatch(/continue-on-error/u);
    expect(text).not.toMatch(/\|\|\s*true/u);
  });

  it("attaches no credential to any step", () => {
    expect(text).not.toMatch(/secrets\./u);
    expect(text).not.toMatch(/github\.token|GITHUB_TOKEN|NODE_AUTH_TOKEN|NPM_TOKEN/u);
    const envKeys = (parsed.jobs["decide-adoption"].steps as Record<string, any>[]).flatMap((step) => Object.keys(step.env ?? {}));
    expect(envKeys).toEqual(["BASE_SHA", "HEAD_SHA"]);
  });

  it("cites nothing that does not ship here", () => {
    expect(text).not.toMatch(/#\d{2,}/u);
    expect(text).not.toMatch(/docs\/|packages\/|SECURITY\.md|AGENTS\.md/u);
    const comments = text.split("\n").filter((line) => line.trimStart().startsWith("#") && !/# v\d/u.test(line));
    for (const line of comments) expect(line).not.toMatch(/https?:\/\//u);
  });
});

describe("decision workflow variants", () => {
  const npm = decision("npm");
  const pnpm = decision("pnpm");

  it("differ only in the name and the install", () => {
    expect(npm).toContain("run: npm ci --ignore-scripts");
    expect(pnpm).toContain("run: pnpm install --frozen-lockfile --ignore-scripts");
    expect(npm).not.toMatch(/pnpm|corepack/u);
    expect(pnpm).not.toContain("npm ci");
    expect(pnpm).toContain("run: corepack enable");
    const strip = (text: string) => text.replace(/\(n?p?npm\)/u, "(X)").replace(/[^\n]*(?:Fixed n?p?npm install|npm ci|pnpm install|Enable pnpm|corepack enable)[^\n]*\n(?:\n)?/gu, "");
    expect(strip(npm)).toBe(strip(pnpm));
  });

  it("carry exactly one install command each", () => {
    const installs = (text: string) => runBodies(text).flatMap((body) => body.split("\n")).filter((line) => /\b(?:npm|pnpm|yarn)\s+(?:ci|install|i|add)\b/u.test(line));
    expect(installs(npm)).toEqual(["npm ci --ignore-scripts"]);
    expect(installs(pnpm)).toEqual(["pnpm install --frozen-lockfile --ignore-scripts"]);
    expect(npm).not.toMatch(/--no-frozen-lockfile|--force/u);
  });
});

describe("Controller CI conventions measurement", () => {
  it("finds the rendered decision workflows satisfied", () => {
    const measured = ["npm", "pnpm"].map((manager) =>
      evaluateCiConventions({
        workflowFiles: [{ path: PATH, content: decision(manager) }],
        ruleset: { requiredContexts: [], maxRetentionDays: 14 },
        declaration: { visibility: "public" },
        packageVersion: "0.0.0",
      }),
    );
    // Satisfied naturally. The one finding is the advisory that no runner
    // conventions were declared in this measurement's input.
    for (const m of measured) {
      expect(m.verdict).toBe("satisfied");
      expect(m.findings.map((f) => `${f.severity}:${f.rule}`)).toEqual(["warning:ci/no-runner-conventions-declared"]);
    }
  });
});

// ---------------------------------------------------------------------------
// The dispatcher
// ---------------------------------------------------------------------------

describe("renderSetupTemplate", () => {
  const ACTS = Object.keys(TEMPLATE_PATHS) as TemplateAct[];
  const inputFor = (act: TemplateAct, packageManager: "npm" | "pnpm"): unknown => {
    if (act === "add-caller-workflow") return { packageManager };
    if (act === "write-starter-request") return input({ packageManager });
    return undefined;
  };

  it.each(["npm", "pnpm"] as const)("returns exactly the TEMPLATE_PATHS paths, in order, for every act (%s)", (packageManager) => {
    expect(ACTS).toEqual(["add-caller-workflow", "write-starter-request", "add-ci-template", "add-path-scope-job"]);
    for (const act of ACTS) {
      expect(files(renderSetupTemplate(act, inputFor(act, packageManager))).map((file) => file.path), act).toEqual(TEMPLATE_PATHS[act]);
    }
  });

  it.each(["npm", "pnpm"] as const)("returns the individual renderers' bytes (%s)", (packageManager) => {
    const caller = files(renderSetupTemplate("add-caller-workflow", { packageManager }));
    expect(caller.map((file) => file.bytes)).toEqual([
      renderAdoptionEvidenceWorkflow(),
      files(renderAdoptionDecisionWorkflow(packageManager))[0]!.bytes,
      renderSnapshotCollector(),
    ]);
    expect(files(renderSetupTemplate("write-starter-request", input({ packageManager })))).toEqual(files(renderStarterRequest(input({ packageManager }))));
    expect(files(renderSetupTemplate("add-ci-template"))).toEqual([{ path: ".github/workflows/clossys-ci.yml", bytes: renderProductCiWorkflow() }]);
    expect(files(renderSetupTemplate("add-path-scope-job"))).toEqual([{ path: ".github/workflows/clossys-path-scope.yml", bytes: renderPathScopeWorkflow() }]);
  });

  it("refuses add-caller-workflow input that is not exactly one packageManager key", () => {
    for (const bad of [undefined, null, [], "npm", 3, {}, { packageManager: "npm", extra: 1 }, { repository: "acme/widgets" }, Object.assign(Object.create({ inherited: 1 }), { packageManager: "npm" }), { packageManager: "npm", [Symbol("x")]: 1 }]) {
      expect(refusal(renderSetupTemplate("add-caller-workflow", bad)), String(bad)).toEqual({ reason: "input-invalid", at: "input" });
    }
    const getter = {};
    Object.defineProperty(getter, "packageManager", { get: () => "npm", enumerable: true });
    expect(refusal(renderSetupTemplate("add-caller-workflow", getter))).toEqual({ reason: "input-invalid", at: "input" });
    const polluted = JSON.parse('{"packageManager":"npm","__proto__":{"x":1}}');
    expect(refusal(renderSetupTemplate("add-caller-workflow", polluted))).toEqual({ reason: "input-invalid", at: "input" });
  });

  it("refuses a bad packageManager for add-caller-workflow at packageManager", () => {
    for (const packageManager of ["yarn", "Yarn", "npm ", "NPM", "", undefined, null, 1, ["npm"], {}]) {
      expect(refusal(renderSetupTemplate("add-caller-workflow", { packageManager })), String(packageManager)).toEqual({ reason: "package-manager-unsupported", at: "packageManager" });
    }
  });

  it("refuses Yarn through the dispatcher for the two acts that take a manager", () => {
    expect(refusal(renderSetupTemplate("add-caller-workflow", { packageManager: "yarn" }))).toEqual({ reason: "package-manager-unsupported", at: "packageManager" });
    expect(refusal(renderSetupTemplate("write-starter-request", input({ packageManager: "yarn" })))).toEqual({ reason: "package-manager-unsupported", at: "packageManager" });
  });

  it("refuses a Starter pin outside the supported range through the dispatcher", () => {
    for (const version of ["0.1.9", "0.3.0"]) {
      expect(refusal(renderSetupTemplate("write-starter-request", input({ starter: pin({ version }) })))).toEqual({ reason: "starter-pin-unsupported", at: "starter.version" });
    }
  });

  it("refuses any input for the two acts that take none", () => {
    for (const act of ["add-ci-template", "add-path-scope-job"] as const) {
      for (const bad of [null, {}, [], "", 0, false, { packageManager: "npm" }]) {
        expect(refusal(renderSetupTemplate(act, bad)), `${act} ${JSON.stringify(bad)}`).toEqual({ reason: "input-invalid", at: "input" });
      }
      expect(renderSetupTemplate(act, undefined).ok).toBe(true);
      expect(renderSetupTemplate(act).ok).toBe(true);
    }
  });

  it("refuses an unknown act at act", () => {
    for (const act of ["", "add-caller-workflow ", "ADD-CI-TEMPLATE", "write-ledger", "toString", "__proto__", "constructor", undefined, null, 1, {}, ["add-ci-template"]]) {
      expect(refusal(renderSetupTemplate(act as unknown as TemplateAct, undefined)), String(act)).toEqual({ reason: "input-invalid", at: "act" });
    }
  });

  it("never echoes the offending value", () => {
    const marker = "MARKER-VALUE-ONE";
    for (const result of [
      renderSetupTemplate(marker as unknown as TemplateAct, marker),
      renderSetupTemplate("add-caller-workflow", { packageManager: marker }),
      renderSetupTemplate("add-caller-workflow", { [marker]: 1 }),
      renderSetupTemplate("add-ci-template", marker),
      renderSetupTemplate("write-starter-request", input({ repository: marker })),
    ]) {
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(marker);
    }
  });

  it("is pure: the same call returns the same bytes twice", () => {
    for (const act of ACTS) {
      expect(renderSetupTemplate(act, inputFor(act, "npm")), act).toEqual(renderSetupTemplate(act, inputFor(act, "npm")));
    }
  });
});
