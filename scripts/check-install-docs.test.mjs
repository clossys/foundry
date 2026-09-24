// Regression tests for check-install-docs.mjs.
//
// Negative and positive fixtures. Logic tests do not require this
// repository's package READMEs; a live CLI assertion against current source
// is included so a #924 regression in tree is still a red suite.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { evaluateInstallDocs, scanInstallDocs } from "./check-install-docs.mjs";
import { makeTmpDirSync } from "./lib/tmp-fixture.mjs";
import { spawnCapture } from "./lib/spawn-capture.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(scriptDir, "check-install-docs.mjs");
const repoRoot = resolve(scriptDir, "..");

test("README with npm install plus create a classic personal access token with read:packages is a finding", () => {
  const result = evaluateInstallDocs({
    "@gate-fixture/alpha": `# @gate-fixture/alpha

## Install

This package is published to GitHub Packages. Create a classic personal access token with \`read:packages\`, then:

\`\`\`bash
npm install @gate-fixture/alpha
\`\`\`
`,
  });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.findings.map((item) => item.rule), ["token-required-install"]);
  assert.equal(result.findings[0].packageName, "@gate-fixture/alpha");
  assert.equal(result.documented.length, 0);
});

test("README that names https://registry.npmjs.org and needs no authentication is documented, no finding", () => {
  const result = evaluateInstallDocs({
    "@gate-fixture/beta": `# @gate-fixture/beta

## Install

\`\`\`bash
npm install @gate-fixture/beta
\`\`\`

This package is published to the public npm registry, \`https://registry.npmjs.org\`.
Installing it needs no authentication: no npm token, no GitHub token.
`,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.documented.map((item) => item.packageName), ["@gate-fixture/beta"]);
  assert.deepEqual(result.undocumented, []);
});

test("README with no install section and no token claim is undocumented, no finding", () => {
  const result = evaluateInstallDocs({
    "@gate-fixture/gamma": `# @gate-fixture/gamma

Does a job. Ships machinery, never a consumer's data.
`,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.documented, []);
  assert.deepEqual(result.undocumented.map((item) => item.packageName), ["@gate-fixture/gamma"]);
});

test("caller-supplied GitHub Packages probe later in the document is not an install instruction", () => {
  const result = evaluateInstallDocs({
    "@gate-fixture/integrator": `# @gate-fixture/integrator

\`\`\`bash
npm install @gate-fixture/integrator
\`\`\`

Published to \`https://registry.npmjs.org\` with public access — installing it
needs no authentication. The GitHub Packages references later in this
document describe a caller-supplied registry; they are not install
instructions for integrator itself.

## Later

Example probe against a caller-supplied GitHub Packages registry:

\`\`\`ts
await lookup({ registry: callerRegistry, name: "@example/pkg" });
\`\`\`
`
  });
  assert.equal(result.exitCode, 0, JSON.stringify(result.findings, null, 2));
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.documented.map((item) => item.packageName), ["@gate-fixture/integrator"]);
});

test("split negative 'no scope mapping or GitHub token is needed' is documented", () => {
  const result = evaluateInstallDocs({
    "@gate-fixture/messenger": `## Install

\`\`\`bash
npm install @gate-fixture/messenger
\`\`\`

The package is published to the public npm registry
(\`https://registry.npmjs.org\`) with public access; no \`@gate-fixture\` scope
mapping or GitHub token is needed to install it.
`,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.documented.map((item) => item.packageName), ["@gate-fixture/messenger"]);
});

test("negative sentence installing it needs no GitHub personal access token is not a finding", () => {
  const result = evaluateInstallDocs({
    "@gate-fixture/delta": `## Install

\`\`\`bash
npm install @gate-fixture/delta
\`\`\`

Published to \`https://registry.npmjs.org\`. Installing it needs no GitHub personal access token.
`,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.documented.map((item) => item.packageName), ["@gate-fixture/delta"]);
});

test("a README with no Install heading that still requires read:packages to install is a finding", () => {
  const result = evaluateInstallDocs({
    "@gate-fixture/epsilon": `# @gate-fixture/epsilon

Installing this package requires \`read:packages\` on a GitHub token.
`,
  });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.findings.map((item) => item.rule), ["token-required-install"]);
});

test("a URL whose path contains registry.npmjs.org does not count as naming public npm", () => {
  const result = evaluateInstallDocs({
    "@gate-fixture/path-host": `## Install

\`\`\`bash
npm install @gate-fixture/path-host
\`\`\`

Published via https://evil.example/registry.npmjs.org. Installing it needs no authentication.
`,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.findings, []);
  assert.equal(result.documented.length, 0);
  assert.equal(result.undocumented[0].packageName, "@gate-fixture/path-host");
});

test("designer-style GitHub Packages peerDependenciesMeta limitation is not an install instruction", () => {
  const result = evaluateInstallDocs({
    "@gate-fixture/designer": `# @gate-fixture/designer

### Token-only use

\`\`\`bash
npm install @gate-fixture/designer
\`\`\`

**Registry note: the token-only path above installs the full peer set
anyway.** That declaration is not honored by GitHub Packages packuments
on \`npm.pkg.github.com\`: the packument omits \`peerDependenciesMeta\` entirely.
`,
  });
  assert.equal(result.exitCode, 0, JSON.stringify(result.findings, null, 2));
  assert.deepEqual(result.findings, []);
  assert.equal(result.undocumented[0].packageName, "@gate-fixture/designer");
});

test("example redaction attributes: { token: \"ghp_...\" } is not an install instruction", () => {
  const result = evaluateInstallDocs({
    "@gate-fixture/observer": `# @gate-fixture/observer

\`\`\`ts
const event = {
  attributes: { token: "ghp_...", changeId: "pr-1234" },
  redactedFields: ["token"],
};
\`\`\`
`,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.findings, []);
});

test("CLI: a tiny repo with a blocking README exits 1", async (t) => {
  const root = makeTmpDirSync(t, "install-docs-block-");
  mkdirSync(join(root, "packages", "alpha"), { recursive: true });
  writeFileSync(join(root, "packages", "alpha", "package.json"), JSON.stringify({ name: "@gate-fixture/alpha" }));
  writeFileSync(join(root, "packages", "alpha", "README.md"), `## Install

Create a classic personal access token with \`read:packages\`.

\`\`\`bash
npm install @gate-fixture/alpha
\`\`\`
`);
  const result = await spawnCapture(process.execPath, [scriptPath, root]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /token-required-install/);
});

test("CLI: a tiny repo with a documented README exits 0 and lists it as documented", async (t) => {
  const root = makeTmpDirSync(t, "install-docs-ok-");
  mkdirSync(join(root, "packages", "beta"), { recursive: true });
  writeFileSync(join(root, "packages", "beta", "package.json"), JSON.stringify({ name: "@gate-fixture/beta" }));
  writeFileSync(join(root, "packages", "beta", "README.md"), `## Install

\`\`\`bash
npm install @gate-fixture/beta
\`\`\`

Published to https://registry.npmjs.org. Installing it needs no authentication.
`);
  const json = await spawnCapture(process.execPath, [scriptPath, "--json", root]);
  assert.equal(json.status, 0, json.stdout + json.stderr);
  const body = JSON.parse(json.stdout);
  assert.deepEqual(body.findings, []);
  assert.equal(body.documented[0].packageName, "@gate-fixture/beta");
  assert.ok(Array.isArray(body.undocumented));
});

test("CLI: undocumented-only READMEs still exit 0 and are listed", async (t) => {
  const root = makeTmpDirSync(t, "install-docs-undoc-");
  mkdirSync(join(root, "packages", "gamma"), { recursive: true });
  writeFileSync(join(root, "packages", "gamma", "package.json"), JSON.stringify({ name: "@gate-fixture/gamma" }));
  writeFileSync(join(root, "packages", "gamma", "README.md"), "# gamma\n\nNo install section.\n");
  const result = await spawnCapture(process.execPath, [scriptPath, "--json", root]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const body = JSON.parse(result.stdout);
  assert.deepEqual(body.findings, []);
  assert.equal(body.undocumented[0].packageName, "@gate-fixture/gamma");
});

test("current packages/*/README.md: live CLI does not report a token-required install", async () => {
  const result = await spawnCapture(process.execPath, [scriptPath, "--json", repoRoot]);
  assert.notEqual(result.status, 2, result.stdout + result.stderr);
  const body = JSON.parse(result.stdout);
  assert.ok(Array.isArray(body.undocumented), "undocumented list must always be present");
  assert.ok(Array.isArray(body.documented), "documented list must always be present");
  if (result.status === 1) {
    assert.fail(`blocking install-doc findings in current source: ${JSON.stringify(body.findings, null, 2)}`);
  }
  assert.equal(result.status, 0);
  const scanned = scanInstallDocs(repoRoot);
  assert.equal(scanned.exitCode, 0);
});
