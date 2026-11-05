import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseSteps } from "./run-check-steps.mjs";

const repository = join(dirname(fileURLToPath(import.meta.url)), "..");
const runner = join(repository, "scripts/run-check-steps.mjs");

test("the root check aggregate runs every step after a failing one and exits non-zero (gate F6)", () => {
  const root = mkdtempSync(join(tmpdir(), "run-check-steps-"));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", private: true, scripts: {
      red: "node -e \"process.exit(3)\"",
      later: "node -e \"require('fs').writeFileSync('later.txt', 'ran')\"",
    } }));
    const result = spawnSync(process.execPath, [runner, "red", "later"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(existsSync(join(root, "later.txt")), true, "the step after the failing one ran");
    assert.match(result.stdout, /2 step\(s\), 1 passed, 1 failed/);
    assert.match(result.stdout, /FAIL {2}red {2}\(exit 3/);
    assert.equal(spawnSync(process.execPath, [runner, "later"], { cwd: root }).status, 0);
    assert.equal(spawnSync(process.execPath, [runner, "--workspace=x"], { cwd: root }).status, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("root check runs through the aggregate: no && chain, every step listed once, check:rules before the Studio steps", () => {
  const { scripts } = JSON.parse(readFileSync(join(repository, "package.json"), "utf8"));
  const words = scripts.check.split(/\s+/);
  assert.deepEqual(words.slice(0, 2), ["node", "scripts/run-check-steps.mjs"]);
  assert.doesNotMatch(scripts.check, /&&|\|\||;/);
  const steps = parseSteps(words.slice(2));
  const labels = steps.map(step => step.workspace ? `${step.script}@${step.workspace}` : step.script);
  assert.equal(new Set(labels).size, labels.length);
  for (const step of steps) if (!step.workspace) assert.equal(typeof scripts[step.script], "string", `${step.script} is a root script`);
  for (const name of ["check:rules", "check:single-reader", "check:no-selection-store", "check:pin-propagation", "check:every-candidate-previewable", "check:orphan-checks", "build", "test"]) assert.ok(labels.includes(name), name);
  assert.equal(labels.at(-1), "check:studio@packages/producer");
  assert.ok(labels.indexOf("build") < labels.indexOf("check:pipeline"), "build still runs before the checks that need dist");
});
