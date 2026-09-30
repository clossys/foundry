import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { makeTmpDirSync } from "./lib/tmp-fixture.mjs";

// Argument handling for scripts/check-readme-parity.mjs. The gate checks one
// package directory per call; every wired caller passes exactly one. A second
// directory used to be ignored silently (the gate read only the first, printed
// OK and exited 0), so it is refused with exit 2 ("cannot run") instead.
// Fixtures follow the shape of the readme-parity block in test-gates.mjs.

const scriptDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(scriptDir, "check-readme-parity.mjs");
const FIXTURE_SCOPE = "@gate-fixture";

function writePackage(root, name, indexTs, readmeMd) {
  const pkgDir = join(root, name);
  mkdirSync(join(pkgDir, "src"), { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name: `${FIXTURE_SCOPE}/${name}`, version: "1.0.0", private: false }, null, 2) + "\n",
  );
  writeFileSync(join(pkgDir, "src", "index.ts"), indexTs);
  writeFileSync(join(pkgDir, "README.md"), readmeMd);
  return pkgDir;
}

function makeFixtures(t) {
  const root = makeTmpDirSync(t, "readme-parity-args-");
  const clean = writePackage(
    root,
    "clean",
    `export const Foo = 1;\n`,
    ["# clean", "", `import { Foo } from "${FIXTURE_SCOPE}/clean";`, "", "| `Foo` | number |", ""].join("\n"),
  );
  // Value export `Baz` appears nowhere in the README.
  const undocumented = writePackage(
    root,
    "undocumented",
    `export const Foo = 1;\nexport const Baz = 2;\n`,
    ["# undocumented", "", "Only mentions `Foo`.", ""].join("\n"),
  );
  return { clean, undocumented };
}

function run(args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("two package dirs are refused with exit 2 and no OK line", (t) => {
  const { clean, undocumented } = makeFixtures(t);
  for (const args of [
    [clean, undocumented],
    ["--json", clean, undocumented],
  ]) {
    const result = run(args);
    const label = args.map((a) => (a.startsWith("--") ? a : "<dir>")).join(" ");
    assert.equal(result.code, 2, `${label}: expected exit 2, got ${result.code}: ${result.stdout}${result.stderr}`);
    assert.equal(result.stdout, "", `${label}: stdout must be empty, got: ${result.stdout}`);
    assert.match(result.stderr, /exactly one package dir/, `${label}: stderr must carry the one-dir usage`);
  }
});

test("one package dir is still checked: clean exits 0 and a finding exits 1", (t) => {
  const { clean, undocumented } = makeFixtures(t);
  const ok = run([clean]);
  assert.equal(ok.code, 0, `clean dir: expected exit 0, got ${ok.code}: ${ok.stdout}${ok.stderr}`);
  const okJson = run(["--json", clean]);
  assert.equal(okJson.code, 0, `clean dir --json: expected exit 0, got ${okJson.code}: ${okJson.stdout}${okJson.stderr}`);
  const bad = run([undocumented]);
  assert.equal(bad.code, 1, `undocumented dir: expected exit 1, got ${bad.code}: ${bad.stdout}${bad.stderr}`);
  assert.match(bad.stdout + bad.stderr, /Baz/, "the finding must name the undocumented export");
});
