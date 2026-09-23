import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { ALL_PACKAGE_RELEASE_ORDER } from "./check-release-catalog.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const checker = join(scriptsDir, "check-foreign-references.mjs");
const futureScope = `@${"clossys"}`;
const transitionPolicy = readFileSync(join(scriptsDir, "..", "governance", "package-identity-transition.json"), "utf8");
const parsedTransitionPolicy = JSON.parse(transitionPolicy);
// The retired producer identity is never spelled out here. It is read from the
// closed transition policy these fixtures are validated against, so a fixture
// cannot drift from the one declaration the gate itself resolves.
const retiredScope = parsedTransitionPolicy.current.scope;
const retiredRegistry = parsedTransitionPolicy.current.registry;
const retiredRepository = parsedTransitionPolicy.current.repository;

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
      { id: "current-github-packages", status: "active", scope: retiredScope, registry: retiredRegistry, packages: "all" },
      { id: "clossys-npmjs-precutover", status: "planned", scope: futureScope, registry: "https://registry.npmjs.org", packages: ["advisor", "starter", "controller"] },
    ],
  });
}

function fixture({ malformed = false, extraFiles = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "foreign-release-catalog-"));
  write(join(root, "package-scope.json"), JSON.stringify({ scope: retiredScope, registry: retiredRegistry }));
  write(join(root, "package.json"), JSON.stringify({ private: true, repository: { type: "git", url: `https://github.com/${retiredRepository}.git` } }));
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

function candidateFixture({ historicalLine = `Retained ${retiredScope}/advisor evidence.`, inventoryLine = null, extraFiles = {} } = {}) {
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
      { id: "current-github-packages", status: "historical", scope: retiredScope, registry: retiredRegistry, packages: "all" },
      { id: "clossys-npmjs", status: "active", scope: futureScope, registry: "https://registry.npmjs.org", access: "public", packages: [...ALL_PACKAGE_RELEASE_ORDER] },
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

test("the appointed-hub placeholder scope is fictional, not a foreign account", () => {
  const root = candidateFixture({
    extraFiles: {
      "docs/ADOPTION.md": "A dedicated hub is named @owner/workspace.\n",
    },
  });
  try {
    const result = run(root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("own-scope hyphenated Agent Skill handles are this repository, not a foreign account", () => {
  const root = candidateFixture({
    extraFiles: {
      "docs/ADOPTION.md": "Talk with @clossys-advisor or @clossys-<package>.\n",
    },
  });
  try {
    const result = run(root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a hyphenated handle under some other scope remains a foreign bare-scope", () => {
  // Interpolate the `@` so this file's own source is not itself a finding.
  const foreignToken = "widgetco-advisor";
  const foreignHandle = `@${foreignToken}`;
  const root = candidateFixture({
    extraFiles: {
      "docs/LEAK.md": `Talk with ${foreignHandle}.\n`,
    },
  });
  try {
    const result = run(root);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, new RegExp(`bare-scope @${foreignToken}`));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a docs.github.com URL is GitHub's documentation site, not a foreign owner/repo slug", () => {
  // The bug this guards: FORGE_URL_RE's plain `github.com` alternative used
  // to match as a substring of ANY host ending in that apex domain, so
  // `docs.github.com/en/billing/...` read the URL's locale segment (`en`)
  // and product segment (`billing`) as an owner/repo pair — issue found in
  // packages/controller/conventions/data/runner-pricing.json, which cites
  // this exact URL as its pricing source.
  const root = fixture({
    extraFiles: {
      "docs/PRICING.md":
        "Source: https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions\n",
    },
  });
  try {
    const result = run(root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a github.com owner/repo URL is still a foreign-reference finding (proves the docs.github.com fix didn't just stop checking)", () => {
  // Built from parts, like the hyphenated-handle case above, so this file's
  // own source is not itself a finding when the real gate scans this repo.
  const foreignSlug = ["widgetco", "private-tool"].join("/");
  const root = fixture({
    extraFiles: {
      "docs/LEAK.md": `See https://github.com/${foreignSlug} for details.\n`,
    },
  });
  try {
    const result = run(root);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, new RegExp(`forge-slug ${foreignSlug.replace("/", "\\/")}`));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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
  const changed = candidateFixture({ inventoryLine: "Retained prior evidence.", historicalLine: `Retained ${retiredScope}/advisor evidence.` });
  const active = candidateFixture({ extraFiles: { "src/current.mjs": `export const active = "${retiredScope}/advisor";\n` } });
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
