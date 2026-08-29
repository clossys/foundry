import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  applyPlanAtomically,
  identityState,
  lineDigest,
  loadTransitionPolicy,
  planIdentityTransition,
  validateHistoryInventory,
} from "./lib/package-identity-transition.mjs";
import { checkCandidatePublishInert } from "./check-package-identity-transition.mjs";

const policy = loadTransitionPolicy(new URL("../governance/package-identity-transition.json", import.meta.url));

function json(value) { return `${JSON.stringify(value, null, 2)}\n`; }

function manifest(directory, dependencies = undefined) {
  return {
    name: `@vespeneventures/${directory}`,
    version: "0.1.0",
    private: false,
    repository: { type: "git", url: "git+https://github.com/vespeneventures/foundry.git", directory: `packages/${directory}` },
    bugs: { url: "https://github.com/vespeneventures/foundry/issues" },
    homepage: `https://github.com/vespeneventures/foundry/tree/main/packages/${directory}#readme`,
    publishConfig: { registry: "https://npm.pkg.github.com" },
    ...(dependencies ? { dependencies } : {}),
  };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "package-identity-transition-"));
  mkdirSync(join(root, "packages", "alpha"), { recursive: true });
  mkdirSync(join(root, "packages", "beta"), { recursive: true });
  mkdirSync(join(root, "governance", "release-qualifications"), { recursive: true });
  mkdirSync(join(root, "docs", "contracts"), { recursive: true });
  writeFileSync(join(root, "package-scope.json"), json({ scope: policy.current.scope, registry: policy.current.registry, status: "current" }));
  writeFileSync(join(root, "packages", "alpha", "package.json"), json(manifest("alpha", { "@vespeneventures/beta": "^0.1.0", thirdparty: "1.0.0" })));
  writeFileSync(join(root, "packages", "beta", "package.json"), json(manifest("beta")));
  writeFileSync(join(root, "package-lock.json"), json({
    name: "fixture",
    lockfileVersion: 3,
    packages: {
      "": { workspaces: ["packages/*"] },
      "packages/alpha": { name: "@vespeneventures/alpha", version: "0.1.0", dependencies: { "@vespeneventures/beta": "^0.1.0", thirdparty: "1.0.0" } },
      "packages/beta": { name: "@vespeneventures/beta", version: "0.1.0" },
      "packages/stale": { name: "@vespeneventures/stale", version: "0.0.1" },
      "node_modules/@vespeneventures/stale": { resolved: "packages/stale", link: true },
      "node_modules/@vespeneventures/alpha": { resolved: "packages/alpha", link: true },
      "node_modules/@vespeneventures/beta": { resolved: "packages/beta", link: true },
      "node_modules/thirdparty": { version: "1.0.0" },
    },
  }));
  writeFileSync(join(root, "governance", "release-catalog.json"), json({
    schemaVersion: 1,
    defaultTarget: "current-github-packages",
    targets: [
      { id: "current-github-packages", status: "active", scope: "@vespeneventures", registry: "https://npm.pkg.github.com", packages: "all" },
      { id: "clossys-npmjs-precutover", status: "planned", scope: "@clossys", registry: "https://registry.npmjs.org", packages: ["advisor", "starter", "controller"] },
    ],
  }));
  const historyBytes = json({ packages: [{ name: "@vespeneventures/alpha", status: "published" }] });
  writeFileSync(join(root, "docs", "contracts", "package-lifecycle.json"), historyBytes);
  writeFileSync(join(root, "governance", "release-qualifications", "alpha-0.1.0.json"), historyBytes);
  return { root, historyBytes };
}

function setterFixture({ candidate = false, access = undefined } = {}) {
  const root = mkdtempSync(join(tmpdir(), "package-identity-setter-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "governance"), { recursive: true });
  mkdirSync(join(root, "packages", "alpha"), { recursive: true });
  cpSync(fileURLToPath(new URL("./set-scope.mjs", import.meta.url)), join(root, "scripts", "set-scope.mjs"));
  cpSync(fileURLToPath(new URL("./set-registry.mjs", import.meta.url)), join(root, "scripts", "set-registry.mjs"));
  writeFileSync(join(root, "governance", "package-identity-transition.json"), readFileSync(new URL("../governance/package-identity-transition.json", import.meta.url)));
  const identity = candidate ? policy.candidate : policy.current;
  writeFileSync(join(root, "package-scope.json"), json({ scope: identity.scope, registry: identity.registry, ...(candidate ? { access: "public" } : {}) }));
  writeFileSync(join(root, "packages", "alpha", "package.json"), json({
    name: `${identity.scope}/alpha`,
    version: "0.1.0",
    private: false,
    publishConfig: { registry: identity.registry, ...(access === undefined ? {} : { access }) },
  }));
  return root;
}

test("the structured W1D plan is complete, candidate-public, declaration-last, and history-preserving", () => {
  const { root, historyBytes } = fixture();
  try {
    const changes = planIdentityTransition({ root, policy });
    assert.equal(changes.at(-1).declaration, true);
    assert.deepEqual(changes.map((change) => change.path.slice(root.length + 1)).sort(), [
      "governance/release-catalog.json",
      "package-lock.json",
      "package-scope.json",
      "packages/alpha/package.json",
      "packages/beta/package.json",
    ]);
    applyPlanAtomically(changes, writeFileSync);
    const scope = JSON.parse(readFileSync(join(root, "package-scope.json"), "utf8"));
    assert.equal(identityState(scope, policy), "candidate");
    assert.equal(scope.access, "public");
    const alpha = JSON.parse(readFileSync(join(root, "packages", "alpha", "package.json"), "utf8"));
    assert.equal(alpha.name, "@clossys/alpha");
    assert.equal(alpha.dependencies["@clossys/beta"], "^0.1.0");
    assert.equal(alpha.dependencies.thirdparty, "1.0.0");
    assert.deepEqual(alpha.publishConfig, { registry: "https://registry.npmjs.org", access: "public" });
    assert.equal(alpha.repository.url, "git+https://github.com/clossys/platform.git");
    const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
    assert.equal(lock.packages["packages/stale"], undefined);
    assert.equal(lock.packages["node_modules/@vespeneventures/stale"], undefined);
    assert.equal(lock.packages["node_modules/@vespeneventures/alpha"], undefined);
    assert.equal(lock.packages["node_modules/@clossys/alpha"].link, true);
    assert.equal(readFileSync(join(root, "docs", "contracts", "package-lifecycle.json"), "utf8"), historyBytes);
    assert.equal(readFileSync(join(root, "governance", "release-qualifications", "alpha-0.1.0.json"), "utf8"), historyBytes);
    assert.deepEqual(planIdentityTransition({ root, policy }), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a candidate declaration alone cannot falsely report a complete candidate state", () => {
  const { root } = fixture();
  try {
    writeFileSync(join(root, "package-scope.json"), json({
      scope: policy.candidate.scope,
      registry: policy.candidate.registry,
      access: policy.candidate.access,
      status: "candidate declaration only",
    }));
    assert.throws(
      () => planIdentityTransition({ root, policy }),
      /candidate declaration is incomplete: .*package\.json.*package-lock\.json.*release-catalog\.json/s,
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("candidate idempotence rejects a manifest and workspace-lock dependency mismatch", () => {
  const { root } = fixture();
  try {
    applyPlanAtomically(planIdentityTransition({ root, policy }), writeFileSync);
    const path = join(root, "packages", "alpha", "package.json");
    const value = JSON.parse(readFileSync(path, "utf8"));
    delete value.dependencies["@clossys/beta"];
    writeFileSync(path, json(value));
    assert.throws(
      () => planIdentityTransition({ root, policy }),
      /dependencies must exactly match package-lock\.json workspace dependencies/,
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("current planning rejects a manifest and workspace-lock dependency mismatch before producing a plan", () => {
  const { root } = fixture();
  try {
    const path = join(root, "packages", "alpha", "package.json");
    const value = JSON.parse(readFileSync(path, "utf8"));
    delete value.dependencies["@vespeneventures/beta"];
    writeFileSync(path, json(value));
    assert.throws(
      () => planIdentityTransition({ root, policy }),
      /current declaration is incomplete: .*dependencies must exactly match package-lock\.json workspace dependencies/,
    );
    assert.equal(JSON.parse(readFileSync(join(root, "package-scope.json"), "utf8")).scope, policy.current.scope);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("mixed source state is rejected before a plan can write anything", () => {
  const { root } = fixture();
  try {
    const path = join(root, "packages", "alpha", "package.json");
    const value = JSON.parse(readFileSync(path, "utf8"));
    value.publishConfig.registry = "https://registry.npmjs.org";
    writeFileSync(path, json(value));
    assert.throws(() => planIdentityTransition({ root, policy }), /mixed registry\/access tuple/);
    assert.equal(JSON.parse(readFileSync(join(root, "package-scope.json"), "utf8")).scope, "@vespeneventures");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a write failure rolls every already-written file back byte-for-byte", () => {
  const files = new Map([["a", "old-a"], ["b", "old-b"], ["c", "old-c"]]);
  let writes = 0;
  assert.throws(
    () => applyPlanAtomically(
      [...files].map(([path, before]) => ({ path, before, after: `new-${path}` })),
      (path, bytes) => {
        writes += 1;
        if (path === "c" && bytes === "new-c") throw new Error("injected write failure");
        files.set(path, bytes);
      },
    ),
    /was rolled back/,
  );
  assert.ok(writes >= 4);
  assert.deepEqual(Object.fromEntries(files), { a: "old-a", b: "old-b", c: "old-c" });
});

test("a writer that mutates bytes before throwing still rolls the current target back", () => {
  const files = new Map([["a", "old-a"], ["b", "old-b"]]);
  assert.throws(
    () => applyPlanAtomically(
      [...files].map(([path, before]) => ({ path, before, after: `new-${path}` })),
      (path, bytes) => {
        files.set(path, bytes);
        if (path === "b" && bytes === "new-b") throw new Error("failure after mutation");
      },
    ),
    /was rolled back/,
  );
  assert.deepEqual(Object.fromEntries(files), { a: "old-a", b: "old-b" });
});

test("candidate publication and provider trust are forbidden across the complete workflow inventory", () => {
  const root = mkdtempSync(join(tmpdir(), "package-identity-workflows-"));
  try {
    const workflows = join(root, ".github", "workflows");
    mkdirSync(workflows, { recursive: true });
    writeFileSync(join(workflows, "publish.yml"), "name: inert\non:\n  workflow_dispatch:\njobs: {}\n");
    writeFileSync(join(workflows, "checks.yaml"), "name: checks\non:\n  pull_request:\njobs: {}\n");
    assert.deepEqual(checkCandidatePublishInert(root), []);

    writeFileSync(join(workflows, "alternate.yml"), "name: hostile\non:\n  push:\njobs:\n  publish:\n    steps:\n      - run: npm publish\n");
    assert.match(checkCandidatePublishInert(root).join("\n"), /alternate\.yml: real npm publish command/);
    rmSync(join(workflows, "alternate.yml"));

    writeFileSync(join(workflows, "mixed.yml"), "name: mixed\non: workflow_dispatch\njobs:\n  publish:\n    steps:\n      - run: npm publish --dry-run && npm publish\n");
    assert.match(checkCandidatePublishInert(root).join("\n"), /mixed\.yml: real npm publish command/);
    writeFileSync(join(workflows, "mixed.yml"), "name: multiple\non: workflow_dispatch\njobs:\n  publish:\n    steps:\n      - run: npm publish --dry-run; npm publish --dry-run\n");
    assert.match(checkCandidatePublishInert(root).join("\n"), /mixed\.yml: real npm publish command/);
    rmSync(join(workflows, "mixed.yml"));

    writeFileSync(join(workflows, "trust.yml"), "name: trust\non: workflow_dispatch\npermissions: { contents: read, \"id-token\": write }\njobs: {}\n");
    assert.match(checkCandidatePublishInert(root).join("\n"), /trust\.yml: provider trust must remain inactive/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("historical exceptions are exact line digests on closed path classes", () => {
  const lineSha256 = lineDigest("old @vespeneventures/advisor evidence");
  assert.deepEqual(validateHistoryInventory({ $comment: "fixture", schemaVersion: 1, references: [{ path: "docs/DECISIONS.md", lineSha256 }] }, policy), []);
  assert.deepEqual(validateHistoryInventory({ $comment: "fixture", schemaVersion: 1, references: [{ path: "packages/advisor/CHANGELOG.md", lineSha256 }] }, policy), []);
  assert.match(validateHistoryInventory({ $comment: "fixture", schemaVersion: 1, references: [{ path: "packages/advisor/src/index.ts", lineSha256 }] }, policy)[0], /admitted relative path/);
  assert.match(validateHistoryInventory({ $comment: "fixture", schemaVersion: 1, references: [{ path: "docs/DECISIONS.md", lineSha256 }, { path: "docs/DECISIONS.md", lineSha256 }] }, policy)[0], /duplicate/);
});

test("legacy setters refuse either half of the closed W1D identity transition", () => {
  const root = setterFixture();
  try {
    const scope = spawnSync(process.execPath, [join(root, "scripts", "set-scope.mjs"), "--scope", policy.candidate.scope], { cwd: root, encoding: "utf8" });
    const registry = spawnSync(process.execPath, [join(root, "scripts", "set-registry.mjs"), "--registry", policy.candidate.registry], { cwd: root, encoding: "utf8" });
    assert.equal(scope.status, 2, scope.stderr || scope.stdout);
    assert.equal(registry.status, 2, registry.stderr || registry.stdout);
    assert.match(scope.stderr, /set-package-identity/);
    assert.match(registry.stderr, /set-package-identity/);
    assert.equal(JSON.parse(readFileSync(join(root, "package-scope.json"), "utf8")).scope, policy.current.scope);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("public npm registry checks require an explicit public access declaration", () => {
  const root = setterFixture({ candidate: true });
  try {
    const result = spawnSync(process.execPath, [join(root, "scripts", "set-registry.mjs"), "--check"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /publishConfig\.access "public"/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
