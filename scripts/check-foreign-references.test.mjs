import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const checker = join(scriptsDir, "check-foreign-references.mjs");
const futureScope = `@${"clossys"}`;
const transitionPolicy = readFileSync(join(scriptsDir, "..", "governance", "package-identity-transition.json"), "utf8");
const parsedTransitionPolicy = JSON.parse(transitionPolicy);

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function catalog({ malformed = false } = {}) {
  if (malformed) return "{";
  return JSON.stringify({
    schemaVersion: 1,
    defaultTarget: "current-github-packages",
    targets: [
      { id: "current-github-packages", status: "active", scope: "@vespeneventures", registry: "https://npm.pkg.github.com", packages: "all" },
      { id: "clossys-npmjs-precutover", status: "planned", scope: futureScope, registry: "https://registry.npmjs.org", packages: ["advisor", "starter", "controller"] },
    ],
  });
}

function fixture({ malformed = false, extraFiles = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "foreign-release-catalog-"));
  write(join(root, "package-scope.json"), JSON.stringify({ scope: "@vespeneventures", registry: "https://npm.pkg.github.com" }));
  write(join(root, "package.json"), JSON.stringify({ private: true, repository: { type: "git", url: "https://github.com/vespeneventures/foundry.git" } }));
  write(join(root, "governance/release-catalog.json"), catalog({ malformed }));
  for (const [path, contents] of Object.entries(extraFiles)) write(join(root, path), contents);
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [checker, root], { encoding: "utf8" });
}

function digestLine(line) {
  return `sha256:${createHash("sha256").update(line).digest("hex")}`;
}

function candidateFixture({ historicalLine = "Retained @vespeneventures/advisor evidence.", inventoryLine = null, extraFiles = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "foreign-candidate-history-"));
  write(join(root, "package-scope.json"), JSON.stringify({ scope: futureScope, registry: "https://registry.npmjs.org", access: "public" }));
  write(join(root, "package.json"), JSON.stringify({ private: true, repository: { type: "git", url: "https://github.com/clossys/foundry.git" } }));
  write(join(root, "packages/advisor/package.json"), JSON.stringify({ name: `${futureScope}/advisor`, repository: { type: "git", url: "https://github.com/clossys/foundry.git" } }));
  write(join(root, "governance/package-identity-transition.json"), transitionPolicy);
  write(join(root, "governance/package-identity-history.json"), JSON.stringify({
    $comment: "fixture",
    schemaVersion: 1,
    references: [{ path: "docs/DECISIONS.md", lineSha256: digestLine(inventoryLine ?? historicalLine) }],
  }));
  const historicalRepositoryLine = `Retained https://github.com/${parsedTransitionPolicy.historicalRepositories[0]}/issues/594 evidence.`;
  write(join(root, "governance/package-repository-history.json"), JSON.stringify({
    $comment: "fixture",
    schemaVersion: 1,
    references: [{
      path: "governance/release-publications/record.json",
      lineSha256: digestLine(historicalRepositoryLine),
      count: 1,
    }],
  }));
  write(join(root, "governance/release-publications/record.json"), `${historicalRepositoryLine}\n`);
  write(join(root, "governance/release-catalog.json"), JSON.stringify({
    schemaVersion: 2,
    defaultTarget: "clossys-npmjs",
    targets: [
      { id: "current-github-packages", status: "historical", scope: "@vespeneventures", registry: "https://npm.pkg.github.com", packages: "all" },
      { id: "clossys-npmjs", status: "active", scope: futureScope, registry: "https://registry.npmjs.org", access: "public", packages: ["advisor", "starter", "controller"] },
    ],
  }));
  write(join(root, "docs/DECISIONS.md"), `${historicalLine}\n`);
  for (const [path, contents] of Object.entries(extraFiles)) write(join(root, path), contents);
  return root;
}

function currentTransitionFixture(extraFiles = {}) {
  const root = fixture({ extraFiles });
  write(join(root, "governance/package-identity-transition.json"), transitionPolicy);
  write(join(root, "governance/package-identity-history.json"), JSON.stringify({ $comment: "fixture", schemaVersion: 1, references: [] }));
  write(join(root, "governance/package-repository-history.json"), JSON.stringify({
    $comment: "fixture",
    schemaVersion: 1,
    references: [{
      path: "governance/release-publications/record.json",
      lineSha256: digestLine("retained only after candidate cutover"),
      count: 1,
    }],
  }));
  return root;
}

test("a future producer scope is admitted only in an exact release-contract documentation surface", () => {
  const root = fixture({ extraFiles: { "docs/PUBLISHING.md": `planned ${futureScope}/advisor target` } });
  try {
    const result = run(root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a future producer scope outside its release-contract surfaces is a foreign-reference finding", () => {
  const root = fixture({ extraFiles: { "src/leak.mjs": `export const leak = "${futureScope}/advisor";` } });
  try {
    const result = run(root);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /FOREIGN reference/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a malformed catalogue cannot grant a future producer scope exception", () => {
  const root = fixture({ malformed: true, extraFiles: { "docs/PUBLISHING.md": `planned ${futureScope}/advisor target` } });
  try {
    const result = run(root);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stderr, /cannot validate governance\/release-catalog\.json/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("candidate state admits a retired identity only at its exact inventoried historical line", () => {
  const root = candidateFixture();
  try {
    const result = run(root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("candidate state rejects changed historical bytes and the same identity on an active source path", () => {
  const changed = candidateFixture({ inventoryLine: "Retained prior evidence.", historicalLine: "Retained @vespeneventures/advisor evidence." });
  const active = candidateFixture({ extraFiles: { "src/current.mjs": 'export const active = "@vespeneventures/advisor";\n' } });
  try {
    const changedResult = run(changed);
    assert.equal(changedResult.status, 1, changedResult.stderr || changedResult.stdout);
    assert.match(changedResult.stdout, /docs\/DECISIONS\.md/);
    const activeResult = run(active);
    assert.equal(activeResult.status, 1, activeResult.stderr || activeResult.stdout);
    assert.match(activeResult.stdout, /src\/current\.mjs/);
  } finally {
    rmSync(changed, { recursive: true, force: true });
    rmSync(active, { recursive: true, force: true });
  }
});

test("the transferred repository admits exact candidate issue trackers but not candidate source references before recut", () => {
  const tracker = currentTransitionFixture({ "docs/DECISIONS.md": "Tracked by https://github.com/clossys/foundry/issues/593.\n" });
  const source = currentTransitionFixture({ "src/current.mjs": 'export const source = "https://github.com/clossys/foundry";\n' });
  try {
    const trackerResult = run(tracker);
    assert.equal(trackerResult.status, 0, trackerResult.stderr || trackerResult.stdout);
    const sourceResult = run(source);
    assert.equal(sourceResult.status, 1, sourceResult.stderr || sourceResult.stdout);
    assert.match(sourceResult.stdout, /src\/current\.mjs/);
  } finally {
    rmSync(tracker, { recursive: true, force: true });
    rmSync(source, { recursive: true, force: true });
  }
});
