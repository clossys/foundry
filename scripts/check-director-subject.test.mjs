// check-director-subject: the facts gate's scan scope. Runs the REAL,
// compiled `clossys director check` (packages/producer/dist/cli/index.js), so it needs
// `npm run build` first -- excluded from check:gates in
// scripts/lib/gate-test-set.mjs and run by `npm run check:director-subject`
// in ci.yml's build job instead, after the build.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { directorCli, directorSubjectArgs } from "./check-director-subject.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLAIM = "This is the only way to release a package.\n";

// A fixture repository root with the real findings subject and a docs/ tree.
function withFixture(docs, fn) {
  const root = mkdtempSync(join(tmpdir(), "director-subject-"));
  try {
    mkdirSync(join(root, "clossys", "evidence", "director"), { recursive: true });
    cpSync(join(repoRoot, "clossys", "evidence", "director", "findings"), join(root, "clossys", "evidence", "director", "findings"), { recursive: true });
    for (const [path, text] of Object.entries(docs)) {
      mkdirSync(dirname(join(root, "docs", path)), { recursive: true });
      writeFileSync(join(root, "docs", path), text);
    }
    fn(spawnSync(process.execPath, directorSubjectArgs(), { cwd: root, encoding: "utf8" }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("the compiled clossys CLI this suite needs exists (run `npm run build` first)", () => {
  assert.ok(existsSync(directorCli), `${directorCli} is missing -- build packages/producer before this suite`);
});

test("a claim in a package changelog under docs/changelogs/ is outside the facts gate's scope", () => {
  withFixture({ "GUIDE.md": "# Guide\n", "changelogs/alpha.md": `# Changelog\n\n## 1.0.0\n\n- ${CLAIM}` }, (result) => {
    const out = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 0, out);
    assert.doesNotMatch(out, /changelogs\//);
  });
});

test("the same claim in any other docs/ file is still flagged", () => {
  withFixture({ "GUIDE.md": `# Guide\n\n${CLAIM}`, "changelogs/alpha.md": `# Changelog\n\n## 1.0.0\n\n- ${CLAIM}` }, (result) => {
    const out = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1, out);
    assert.match(out, /\[untraced-superlative-claim\] GUIDE\.md:3/);
    assert.doesNotMatch(out, /changelogs\//);
  });
});
