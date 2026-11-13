import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDirSync } from "./lib/tmp-fixture.mjs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { evaluatePackageReadme } from "./check-readme-parity.mjs";

const manifest = {
  name: "@gate-fixture/alpha", private: false,
  repository: { url: "git+https://github.com/gate-fixture-owner/example-repo.git" },
};
const lines = [
  "# @gate-fixture/alpha", "Tools for the example workflow.", "",
  "Install: `npm install @gate-fixture/alpha --registry=https://registry.npmjs.org` (no authentication).",
  "[Documentation](https://clossys.com/docs/alpha) · [Changelog](https://github.com/gate-fixture-owner/example-repo/blob/main/docs/changelogs/alpha.md) · [License](./LICENSE)",
];
const input = { manifest, packageDir: "alpha", readme: lines.join("\n") + "\n", licenseExists: true };
const rules = (value) => evaluatePackageReadme(value).map((finding) => finding.rule);

test("five-line public README points to docs without duplicating API exports", () => {
  assert.deepEqual(evaluatePackageReadme(input), []);
});

for (const [name, index, replacement, expected] of [
  ["wrong package name", 0, "# @gate-fixture/other", "package-name"],
  ["missing purpose", 1, "", "purpose"],
  ["extra content on blank line", 2, "## API", "spacing"],
  ["wrong install identity", 3, lines[3].replace("/alpha", "/other"), "install"],
  ["credentialed registry", 3, lines[3].replace("registry.npmjs.org", "npm.pkg.github.com"), "install"],
  ["missing no-auth claim", 3, lines[3].replace(" (no authentication)", ""), "install"],
  ["wrong docs package", 4, lines[4].replace("/docs/alpha", "/docs/other"), "links"],
  ["missing changelog", 4, lines[4].replace(/ · \[Changelog\]\([^)]*\)/, ""), "links"],
  ["missing license link", 4, lines[4].replace(" · [License](./LICENSE)", ""), "links"],
]) {
  test(`README mutation refuses ${name}`, () => {
    const changed = [...lines]; changed[index] = replacement;
    assert.ok(rules({ ...input, readme: changed.join("\n") + "\n" }).includes(expected));
  });
}

test("README mutation refuses an added sixth line and a missing license file", () => {
  assert.ok(rules({ ...input, readme: input.readme + "Extra API content.\n" }).includes("five-lines"));
  assert.ok(rules({ ...input, licenseExists: false }).includes("license"));
});

test("third-party notice attribution must remain linked when the file exists", () => {
  assert.ok(rules({ ...input, noticesExist: true }).includes("links"));
  assert.deepEqual(rules({ ...input, noticesExist: true, readme: input.readme.trimEnd() + " · [Third-party notices](./THIRD-PARTY-NOTICES.md)\n" }), []);
});

test("private package install is explicitly local and unpublished", () => {
  const privateInput = { ...input, manifest: { ...manifest, private: true } };
  assert.ok(rules(privateInput).includes("install"));
  const changed = [...lines];
  changed[3] = "Install: local workspace only; run `npm install` at the repository root. This package is unpublished.";
  assert.deepEqual(rules({ ...privateInput, readme: changed.join("\n") + "\n" }), []);
});

test("a missing repository cannot silently drop the changelog contract", () => {
  assert.ok(rules({ ...input, manifest: { ...manifest, repository: undefined } }).includes("repository"));
});

test("CLI refuses two package dirs and unknown flags with exit 2", () => {
  const script = fileURLToPath(new URL("./check-readme-parity.mjs", import.meta.url));
  for (const args of [["one", "two"], ["--json", "one", "two"], ["one", "--unknown"]]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /exactly one package dir/);
  }
});

test("CLI JSON preserves its machine-facing package, directory, findings, and ok fields", () => {
  const script = fileURLToPath(new URL("./check-readme-parity.mjs", import.meta.url));
  const packageDir = fileURLToPath(new URL("../packages/advisor", import.meta.url));
  const packageName = JSON.parse(readFileSync(new URL("../packages/advisor/package.json", import.meta.url), "utf8")).name;
  const result = spawnSync(process.execPath, [script, packageDir, "--json"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { package: packageName, packageDir, findings: [], ok: true });
});

test("CLI rejects full-length and missing READMEs with exit 1", (t) => {
  const root = makeTmpDirSync(t, "readme-stub-mutation-");
  const packageDir = join(root, "alpha");
  mkdirSync(packageDir);
  writeFileSync(join(packageDir, "package.json"), JSON.stringify(manifest));
  writeFileSync(join(packageDir, "LICENSE"), "MIT\n");
  const readmePath = join(packageDir, "README.md");
  const script = fileURLToPath(new URL("./check-readme-parity.mjs", import.meta.url));
  const run = () => spawnSync(process.execPath, [script, packageDir], { encoding: "utf8" });
  writeFileSync(readmePath, input.readme);
  assert.equal(run().status, 0);
  try {
    writeFileSync(readmePath, input.readme + "\n## API\n\nFull documentation belongs on the documentation site.\n");
    const long = run();
    assert.equal(long.status, 1, long.stdout + long.stderr);
    assert.match(long.stdout, /five-lines/);
  } finally {
    writeFileSync(readmePath, input.readme);
  }
  assert.equal(run().status, 0);
  try {
    unlinkSync(readmePath);
    const missing = run();
    assert.equal(missing.status, 1, missing.stdout + missing.stderr);
    assert.match(missing.stderr, /missing or unreadable README/);
  } finally {
    writeFileSync(readmePath, input.readme);
  }
  assert.equal(run().status, 0);
});

test("every declared package workspace has a valid five-line README", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const packageDirs = readdirSync(join(root, "packages"))
    .map((dir) => join(root, "packages", dir))
    .filter((dir) => existsSync(join(dir, "package.json")));
  packageDirs.push(join(root, "packages/designer/ui"));
  const script = fileURLToPath(new URL("./check-readme-parity.mjs", import.meta.url));
  for (const dir of packageDirs) {
    const result = spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
});
