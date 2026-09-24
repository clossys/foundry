import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  classifyCandidates,
  evaluateRange,
  firstPartyRuntimeRanges,
  lookupPublishedVersions,
  renderSummary,
} from "./classify-qualification-dispatch.mjs";
import { PUBLIC_NPM_REGISTRY } from "./lib/public-npm-registry.mjs";
import { spawnCapture } from "./lib/spawn-capture.mjs";

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "classify-qualification-dispatch.mjs");
const workflowPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows", "auto-qualify.yml");
const INDETERMINATE_LOG_PREFIX = "classify-qualification-dispatch: indeterminate:";
const SCOPE = "@clossys";

// A fake public registry: `versionsByName` maps a package name to its
// published version list; a name mapped to an Error makes the lookup fail.
function fakeRegistry(versionsByName) {
  const calls = [];
  const lookupVersions = async (name) => {
    calls.push(name);
    const entry = versionsByName[name];
    if (entry instanceof Error) return { kind: "error", detail: entry.message };
    if (entry === undefined) return { kind: "absent" };
    return { kind: "found", versions: entry };
  };
  return { lookupVersions, calls };
}

function manifestsFrom(byPackage) {
  return (pkg) => {
    if (!(pkg in byPackage)) throw new Error(`ENOENT packages/${pkg}/package.json`);
    return byPackage[pkg];
  };
}

async function classifyOne(manifest, versionsByName) {
  const candidate = { package: "subject", name: manifest.name, version: manifest.version };
  const { lookupVersions } = fakeRegistry(versionsByName);
  const rows = await classifyCandidates({ unqualified: [candidate], pending: [candidate], scope: SCOPE, readManifest: manifestsFrom({ subject: manifest }), lookupVersions });
  assert.equal(rows.length, 1);
  return rows[0];
}

// ------------------------------------------------------------ range handling

test("evaluateRange: 0.x tilde is minor-locked and picks the highest satisfying version", () => {
  assert.deepEqual(evaluateRange("~0.9.14", ["0.9.13", "0.9.14", "0.9.20", "0.10.0"]), { kind: "satisfied", version: "0.9.20" });
});

test("evaluateRange: prerelease-only matches do not satisfy a plain range (semver default)", () => {
  assert.deepEqual(evaluateRange("~0.9.14", ["0.9.13", "0.9.14-rc.1", "0.9.15-next.0"]), { kind: "unsatisfied", highest: "0.9.13" });
  assert.deepEqual(evaluateRange("^1.0.0", ["1.0.0-beta.2"]), { kind: "unsatisfied", highest: null });
});

test("evaluateRange: a range form the shared evaluator does not parse is reported, never guessed", () => {
  assert.deepEqual(evaluateRange(">=0.9.0", ["0.9.1"]), { kind: "unevaluable" });
});

test("firstPartyRuntimeRanges: dependencies and required peers inside the scope only; optional peers and devDependencies ignored", () => {
  const edges = firstPartyRuntimeRanges({
    dependencies: { "@clossys/controller": "~0.9.14", react: "^19.0.0" },
    peerDependencies: { "@clossys/writer": "^0.4.0", "@clossys/designer": "^0.6.0", "react-dom": "^19.0.0" },
    peerDependenciesMeta: { "@clossys/designer": { optional: true } },
    devDependencies: { "@clossys/advisor": "^9.9.9" },
  }, SCOPE);
  assert.deepEqual(edges, [
    { name: "@clossys/controller", range: "~0.9.14" },
    { name: "@clossys/writer", range: "^0.4.0" },
  ]);
});

// ------------------------------------------------------------- classification

test("classify: every first-party range satisfiable -> dispatch", async () => {
  const row = await classifyOne(
    { name: "@clossys/builder", version: "0.10.2", dependencies: { "@clossys/controller": "~0.9.0" } },
    { "@clossys/controller": ["0.9.2", "0.9.23"] },
  );
  assert.equal(row.classification, "dispatch");
});

test("classify: sibling range with no published satisfying version -> blocked-on-sibling naming sibling and range", async () => {
  const row = await classifyOne(
    { name: "@clossys/inspector", version: "0.4.0", dependencies: { "@clossys/controller": "~0.10.0" } },
    { "@clossys/controller": ["0.9.23"] },
  );
  assert.equal(row.classification, "blocked-on-sibling");
  assert.deepEqual(row.blockers.map(({ name, range, highest }) => ({ name, range, highest })), [{ name: "@clossys/controller", range: "~0.10.0", highest: "0.9.23" }]);
});

test("classify: a sibling that was never published (definitive public-npm 404) -> blocked-on-sibling", async () => {
  const row = await classifyOne({ name: "@clossys/alpha", version: "0.1.0", dependencies: { "@clossys/brand-new": "^0.1.0" } }, {});
  assert.equal(row.classification, "blocked-on-sibling");
  assert.match(row.blockers[0].detail, /no version of @clossys\/brand-new is published/);
});

test("classify: sibling published only as a prerelease -> blocked-on-sibling (semver default excludes prereleases)", async () => {
  const row = await classifyOne(
    { name: "@clossys/alpha", version: "0.2.0", dependencies: { "@clossys/controller": "~0.9.14" } },
    { "@clossys/controller": ["0.9.13", "0.9.14-next.1"] },
  );
  assert.equal(row.classification, "blocked-on-sibling");
});

test("classify: registry error -> indeterminate, never blocked, never dispatched", async () => {
  const row = await classifyOne(
    { name: "@clossys/alpha", version: "0.2.0", dependencies: { "@clossys/controller": "~0.9.14" } },
    { "@clossys/controller": new Error("HTTP 503") },
  );
  assert.equal(row.classification, "indeterminate");
  assert.match(row.uncertain[0].detail, /503/);
});

test("classify: one definitive blocker outweighs an unrelated registry error (the install cannot succeed either way)", async () => {
  const row = await classifyOne(
    { name: "@clossys/alpha", version: "0.2.0", dependencies: { "@clossys/controller": "~0.9.14", "@clossys/writer": "^0.4.0" } },
    { "@clossys/controller": ["0.9.13"], "@clossys/writer": new Error("timeout") },
  );
  assert.equal(row.classification, "blocked-on-sibling");
  assert.equal(row.uncertain.length, 1);
});

test("classify: non-first-party dependencies are ignored entirely (never looked up)", async () => {
  const manifest = { name: "@clossys/alpha", version: "0.2.0", dependencies: { react: "^99.0.0", "@other/x": "^1.0.0" } };
  const { lookupVersions, calls } = fakeRegistry({});
  const candidate = { package: "alpha", name: manifest.name, version: manifest.version };
  const rows = await classifyCandidates({ unqualified: [candidate], pending: [candidate], scope: SCOPE, readManifest: manifestsFrom({ alpha: manifest }), lookupVersions });
  assert.equal(rows[0].classification, "dispatch");
  assert.deepEqual(calls, []);
});

test("classify: an unevaluable first-party range does not block; it dispatches and is named", async () => {
  const row = await classifyOne({ name: "@clossys/alpha", version: "0.2.0", dependencies: { "@clossys/controller": ">=0.9.0" } }, { "@clossys/controller": ["0.9.1"] });
  assert.equal(row.classification, "dispatch");
  assert.deepEqual(row.unevaluated, [{ name: "@clossys/controller", range: ">=0.9.0" }]);
});

test("classify: candidates missing from pending are skipped-already-recorded; unreadable manifests are indeterminate; lookups cached per sibling", async () => {
  const unqualified = [
    { package: "alpha", name: "@clossys/alpha", version: "1.0.0" },
    { package: "beta", name: "@clossys/beta", version: "1.0.0" },
    { package: "gamma", name: "@clossys/gamma", version: "1.0.0" },
    { package: "ghost", name: "@clossys/ghost", version: "1.0.0" },
  ];
  const pending = unqualified.slice(1);
  const manifests = {
    beta: { name: "@clossys/beta", version: "1.0.0", dependencies: { "@clossys/controller": "~0.9.0" } },
    gamma: { name: "@clossys/gamma", version: "1.0.0", dependencies: { "@clossys/controller": "~0.9.5" } },
  };
  const { lookupVersions, calls } = fakeRegistry({ "@clossys/controller": ["0.9.23"] });
  const rows = await classifyCandidates({ unqualified, pending, scope: SCOPE, readManifest: manifestsFrom(manifests), lookupVersions });
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.package, r.classification])), {
    alpha: "skipped-already-recorded",
    beta: "dispatch",
    gamma: "dispatch",
    ghost: "indeterminate",
  });
  assert.deepEqual(calls, ["@clossys/controller"]);
});

// ----------------------------------------------------- 2026-09-24 replay (#1476)

// Real publisher manifests from main on 2026-09-24, against the real public
// registry. Version lists come from `npm view @clossys/<x> time --json`:
// REGISTRY_1708Z keeps only versions published before 2026-09-24T17:08Z
// (controller 0.9.23 landed 19:41Z; designer 0.6.0 and writer 0.4.0 landed
// 18:39Z). The 26 failed runs that day were 14 ETARGET on designer@^0.5.0
// (designer has never published a 0.5.x) and 12 on controller@~0.9.14.
// npm names only the first unsatisfiable edge it hits; the classifier names
// every one, so the replay asserts the edge npm failed on is among them.
const PUBLISHER_060 = {
  name: "@clossys/publisher",
  version: "0.6.0",
  dependencies: { "@clossys/writer": "^0.3.0", "@clossys/designer": "^0.5.0", "@clossys/controller": "~0.9.14" },
};
const PUBLISHER_070 = {
  name: "@clossys/publisher",
  version: "0.7.0",
  dependencies: { "@clossys/writer": "^0.4.0", "@clossys/designer": "^0.6.0", "@clossys/controller": "~0.9.14" },
  peerDependencies: { react: "^19.0.0" },
  peerDependenciesMeta: { react: { optional: true } },
};
const REGISTRY_1708Z = {
  "@clossys/controller": ["0.8.21", "0.8.23", "0.8.24", "0.9.2", "0.9.4", "0.9.5", "0.9.6", "0.9.7", "0.9.10"],
  "@clossys/designer": ["0.2.4", "0.2.7", "0.4.1", "0.4.3", "0.4.4", "0.4.5", "0.4.6", "0.4.7"],
  "@clossys/writer": ["0.3.2", "0.3.3", "0.3.4", "0.3.6", "0.3.8", "0.3.9"],
};
// After controller 0.9.23 (19:41Z), designer 0.6.0 and writer 0.4.0 (18:39Z).
const REGISTRY_AFTER_1941Z = {
  "@clossys/controller": [...REGISTRY_1708Z["@clossys/controller"], "0.9.23"],
  "@clossys/designer": [...REGISTRY_1708Z["@clossys/designer"], "0.6.0"],
  "@clossys/writer": [...REGISTRY_1708Z["@clossys/writer"], "0.4.0"],
};
const blockerTuples = (row) => row.blockers.map(({ name, range, highest }) => ({ name, range, highest }));

test("replay 2026-09-24 (designer@^0.5.0 shape): publisher@0.6.0 -> blocked-on-sibling naming designer ^0.5.0, not dispatched", async () => {
  const row = await classifyOne(PUBLISHER_060, REGISTRY_1708Z);
  assert.equal(row.classification, "blocked-on-sibling");
  assert.deepEqual(blockerTuples(row), [
    { name: "@clossys/controller", range: "~0.9.14", highest: "0.9.10" },
    { name: "@clossys/designer", range: "^0.5.0", highest: "0.4.7" },
  ]);
});

test("replay 2026-09-24 (controller@~0.9.14 shape): publisher@0.7.0 with registry controller max 0.9.10 -> blocked-on-sibling, not dispatched", async () => {
  const row = await classifyOne(PUBLISHER_070, REGISTRY_1708Z);
  assert.equal(row.classification, "blocked-on-sibling");
  assert.deepEqual(blockerTuples(row), [
    { name: "@clossys/controller", range: "~0.9.14", highest: "0.9.10" },
    { name: "@clossys/designer", range: "^0.6.0", highest: "0.4.7" },
    { name: "@clossys/writer", range: "^0.4.0", highest: "0.3.9" },
  ]);
  assert.match(renderSummary([row]), /`@clossys\/controller@~0\.9\.14` \(highest published @clossys\/controller is 0\.9\.10\)/);
});

test("replay 2026-09-24: once controller 0.9.23, designer 0.6.0 and writer 0.4.0 are published, publisher@0.7.0 dispatches", async () => {
  const row = await classifyOne(PUBLISHER_070, REGISTRY_AFTER_1941Z);
  assert.equal(row.classification, "dispatch");
});

test("replay 2026-09-24: publisher@0.6.0 stays blocked even after that, on designer ^0.5.0 alone (never published)", async () => {
  const row = await classifyOne(PUBLISHER_060, REGISTRY_AFTER_1941Z);
  assert.equal(row.classification, "blocked-on-sibling");
  assert.deepEqual(blockerTuples(row), [{ name: "@clossys/designer", range: "^0.5.0", highest: "0.6.0" }]);
});

// --------------------------------------------------- real registry adapter path

function fakeFetch(routes) {
  return async (url) => {
    const route = routes[url];
    if (route instanceof Error) throw route;
    if (route === undefined) return { status: 404, ok: false, json: async () => ({}) };
    return { status: route.status ?? 200, ok: (route.status ?? 200) < 300, json: async () => route.body };
  };
}
const packumentUrl = (name) => `${PUBLIC_NPM_REGISTRY}/${encodeURIComponent(name)}`;

test("lookupPublishedVersions: 200 packument -> found versions; 404 -> absent; 5xx, throw, malformed body -> error", async () => {
  const name = "@clossys/controller";
  const ok = await lookupPublishedVersions(name, { registry: PUBLIC_NPM_REGISTRY, fetchImpl: fakeFetch({ [packumentUrl(name)]: { body: { name, versions: { "0.9.13": {}, "0.9.14-rc.1": {} } } } }) });
  assert.deepEqual(ok, { kind: "found", versions: ["0.9.13", "0.9.14-rc.1"] });
  assert.deepEqual(await lookupPublishedVersions(name, { registry: PUBLIC_NPM_REGISTRY, fetchImpl: fakeFetch({}) }), { kind: "absent" });
  assert.equal((await lookupPublishedVersions(name, { registry: PUBLIC_NPM_REGISTRY, fetchImpl: fakeFetch({ [packumentUrl(name)]: { status: 503 } }) })).kind, "error");
  assert.equal((await lookupPublishedVersions(name, { registry: PUBLIC_NPM_REGISTRY, fetchImpl: fakeFetch({ [packumentUrl(name)]: new Error("ECONNRESET") }) })).kind, "error");
  assert.equal((await lookupPublishedVersions(name, { registry: PUBLIC_NPM_REGISTRY, fetchImpl: fakeFetch({ [packumentUrl(name)]: { body: { name: "@other/x", versions: {} } } }) })).kind, "error");
});

test("lookupPublishedVersions: a registry other than public npm is never guessed at -> error (indeterminate upstream)", async () => {
  let fetched = false;
  const result = await lookupPublishedVersions("@clossys/controller", { registry: "https://registry.example.test", fetchImpl: async () => { fetched = true; } });
  assert.equal(result.kind, "error");
  assert.equal(fetched, false);
});

// ---------------------------------------------------------------- CLI coverage

test("CLI: prints only dispatchable rows as JSON and writes a four-way step summary (hermetic: no registry reads)", async () => {
  const root = mkdtempSync(join(tmpdir(), "classify-qualification-dispatch-test-"));
  try {
    // A non-public registry makes every sibling lookup fail closed without a network call.
    writeFileSync(join(root, "package-scope.json"), JSON.stringify({ scope: SCOPE, registry: "https://registry.example.test" }));
    const write = (pkg, manifest) => {
      mkdirSync(join(root, "packages", pkg), { recursive: true });
      writeFileSync(join(root, "packages", pkg, "package.json"), JSON.stringify(manifest));
    };
    write("leaf", { name: "@clossys/leaf", version: "1.0.0", dependencies: { react: "^19.0.0" } });
    write("dependent", { name: "@clossys/dependent", version: "1.0.0", dependencies: { "@clossys/leaf": "^1.0.0" } });
    const unqualified = [
      { package: "leaf", name: "@clossys/leaf", version: "1.0.0" },
      { package: "dependent", name: "@clossys/dependent", version: "1.0.0" },
      { package: "done", name: "@clossys/done", version: "2.0.0" },
    ];
    writeFileSync(join(root, "unqualified.json"), JSON.stringify(unqualified));
    writeFileSync(join(root, "pending.json"), JSON.stringify(unqualified.slice(0, 2)));
    const summary = join(root, "summary.md");
    const result = await spawnCapture(process.execPath, [scriptPath, join(root, "unqualified.json"), join(root, "pending.json"), "--json", "--summary", summary, "--root", root], { cwd: root });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [{ package: "leaf", name: "@clossys/leaf", version: "1.0.0" }]);
    assert.match(result.stderr, /indeterminate: `dependent`/);
    // auto-qualify.yml's ::warning:: annotation greps for exactly this line prefix.
    assert.match(result.stderr, new RegExp(`^${INDETERMINATE_LOG_PREFIX}`, "m"));
    const text = readFileSync(summary, "utf8");
    assert.match(text, /\| dispatch \| 1 \|/);
    assert.match(text, /\| skipped-already-recorded \| 1 \|/);
    assert.match(text, /\| blocked-on-sibling \| 0 \|/);
    assert.match(text, /\| indeterminate \| 1 \|/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("auto-qualify.yml: raises a ::warning:: when any candidate is indeterminate, keyed on the script's own stderr prefix", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const step = workflow.slice(workflow.indexOf("- name: Hold back candidates blocked on an unpublished first-party sibling"), workflow.indexOf("- name: Dispatch qualify-candidate.yml for each"));
  assert.ok(step.includes("scripts/classify-qualification-dispatch.mjs"), "classification step runs the classifier");
  assert.ok(step.includes(`grep -q '^${INDETERMINATE_LOG_PREFIX}'`), "warning is keyed on the indeterminate stderr prefix");
  assert.match(step, /echo "::warning title=[^"]*::/);
  assert.match(step, /> "\$RUNNER_TEMP\/dispatch\.json"/);
  assert.match(workflow, /Dispatch qualify-candidate\.yml for each[\s\S]*"\$RUNNER_TEMP\/dispatch\.json"/);
});
