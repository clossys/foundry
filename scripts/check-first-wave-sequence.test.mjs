import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  REQUIRED_TRIO,
  evaluateFirstWaveSequence,
  loadAndEvaluate,
} from "./check-first-wave-sequence.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "scripts/check-first-wave-sequence.mjs");

function contract(overrides = {}) {
  return {
    schemaVersion: 1,
    priority: [
      "catalogue-integrity",
      "engagement",
      "executable-tooling",
      "operational-integrity",
      "frontend-expression",
    ],
    trioPrefix: [...REQUIRED_TRIO],
    nonRuntimeOrder: [
      {
        earlier: "customer",
        later: "publisher",
        reason: "Seal only after a first-person keep.",
      },
      {
        earlier: "publisher",
        later: "influencer",
        reason: "Audience-response measurement is the learn stage of publication.",
      },
    ],
    waves: [
      { id: "catalogue-integrity", kind: "catalogue-integrity", job: "installable", packages: [] },
      { id: "engagement-gate", kind: "engagement", job: "advisor first", packages: ["advisor"] },
      { id: "trusted-base", kind: "executable-tooling", job: "starter", packages: ["starter"] },
      { id: "operating-rules", kind: "operational-integrity", job: "controller", packages: ["controller"] },
      {
        id: "operating-control",
        kind: "operational-integrity",
        job: "ops",
        packages: ["observer", "architect", "inspector", "builder", "locksmith", "integrator"],
      },
      {
        id: "agreements-and-custody",
        kind: "operational-integrity",
        job: "custody",
        packages: ["bouncer", "butler", "messenger", "giver", "keeper"],
      },
      {
        id: "strategy-and-expression",
        kind: "frontend-expression",
        job: "expression last",
        packages: ["strategist", "writer", "designer", "customer", "publisher", "influencer"],
      },
    ],
    productizationCriteria: [
      { id: "charter", owner: "supplier", gated: "check:role-loop-archetypes", means: "one job, one metric, one loop" },
    ],
    backlogRouting: [{ kind: "package-productization", wave: "that-package", matches: "named package gap" }],
    ...overrides,
  };
}

function manifests(entries) {
  const map = new Map();
  for (const [directory, dependencies] of entries) {
    map.set(directory, { name: `@clossys/${directory}`, dependencies });
  }
  return map;
}

function allManifests(overrides = {}) {
  const directories = [
    "advisor", "starter", "controller", "observer", "architect", "inspector", "builder",
    "locksmith", "integrator", "bouncer", "butler", "messenger", "giver", "keeper",
    "strategist", "writer", "designer", "customer", "publisher", "influencer",
  ];
  const deps = {
    builder: { "@clossys/controller": "~0.9.0" },
    inspector: { "@clossys/controller": "~0.9.0" },
    publisher: {
      "@clossys/controller": "~0.9.0",
      "@clossys/writer": "^0.3.0",
      "@clossys/designer": "^0.4.0",
    },
    ...overrides,
  };
  return manifests(directories.map((directory) => [directory, deps[directory] ?? {}]));
}

function rules(result) {
  return result.findings.map((item) => item.rule);
}

test("the committed repository contract passes", () => {
  const result = loadAndEvaluate(repoRoot);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.sequence.slice(0, 3), ["advisor", "starter", "controller"]);
  assert.equal(result.sequence.at(-2), "publisher");
  assert.equal(result.sequence.at(-1), "influencer");
});

test("the fixture matching the contract and runtime graph passes", () => {
  assert.deepEqual(rules(evaluateFirstWaveSequence({ contract: contract(), manifestsByDirectory: allManifests() })), []);
});

test("putting an expression package before operating control is a finding", () => {
  const drifted = contract();
  drifted.waves = [
    drifted.waves[0],
    drifted.waves[1],
    drifted.waves[2],
    drifted.waves[3],
    drifted.waves[6],
    drifted.waves[4],
    drifted.waves[5],
  ];
  const found = rules(evaluateFirstWaveSequence({ contract: drifted, manifestsByDirectory: allManifests() }));
  assert.equal(found.includes("frontend-before-operations"), true);
});

test("publisher before writer is a runtime-order finding even inside expression", () => {
  const drifted = contract();
  drifted.waves[6].packages = ["strategist", "publisher", "writer", "designer", "influencer"];
  assert.equal(
    rules(evaluateFirstWaveSequence({ contract: drifted, manifestsByDirectory: allManifests() })).includes("runtime-order-violation"),
    true,
  );
});

test("influencer before publisher violates the closed-loop non-runtime constraint", () => {
  const drifted = contract();
  drifted.waves[6].packages = ["strategist", "writer", "designer", "influencer", "publisher"];
  assert.equal(
    rules(evaluateFirstWaveSequence({ contract: drifted, manifestsByDirectory: allManifests() })).includes("non-runtime-order-violation"),
    true,
  );
});

test("a sequence that skips advisor as the first package is a finding", () => {
  const drifted = contract();
  drifted.waves[1].packages = ["controller"];
  drifted.waves[3].packages = ["advisor"];
  const found = rules(evaluateFirstWaveSequence({ contract: drifted, manifestsByDirectory: allManifests() }));
  assert.equal(found.includes("advisor-not-first-package"), true);
  assert.equal(found.includes("trio-prefix-broken"), true);
});

test("an omitted current package is a finding, not a silent pass", () => {
  const drifted = contract();
  drifted.waves[4].packages = drifted.waves[4].packages.filter((name) => name !== "observer");
  assert.equal(
    rules(evaluateFirstWaveSequence({ contract: drifted, manifestsByDirectory: allManifests() })).includes("package-missing-from-sequence"),
    true,
  );
});

test("a first-party runtime edge to an unknown package is a finding", () => {
  const found = rules(evaluateFirstWaveSequence({
    contract: contract(),
    manifestsByDirectory: allManifests({ builder: { "@clossys/not-a-role": "1.0.0" } }),
  }));
  assert.equal(found.includes("unknown-runtime-dependency"), true);
});

test("weakening the priority so expression outranks operations is a finding", () => {
  const drifted = contract({
    priority: [
      "catalogue-integrity",
      "engagement",
      "executable-tooling",
      "frontend-expression",
      "operational-integrity",
    ],
  });
  assert.equal(
    rules(evaluateFirstWaveSequence({ contract: drifted, manifestsByDirectory: allManifests() })).includes("priority-drift"),
    true,
  );
});

test("the CLI reports PASS on this repository", () => {
  const run = spawnSync(process.execPath, [script], { encoding: "utf8", cwd: repoRoot });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /first-wave sequence: PASS/);
  assert.match(run.stdout, /advisor -> starter -> controller/);
});
