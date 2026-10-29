import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadScenarios, SCENARIOS_DIR } from "./scenario-runner.mjs";

function withScenariosDir(files, run) {
  const dir = mkdtempSync(join(tmpdir(), "evals-scenario-runner-test-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content);
    }
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("loadScenarios: reads every *.json file, sorted by name", () => {
  withScenariosDir(
    {
      "b-scenario.json": JSON.stringify({ id: "b-scenario", confirmedProblems: [], expect: { state: "indeterminate" } }),
      "a-scenario.json": JSON.stringify({ id: "a-scenario", confirmedProblems: [], expect: { state: "indeterminate" } }),
      "not-json.txt": "ignored",
    },
    (dir) => {
      const scenarios = loadScenarios(dir);
      assert.deepEqual(scenarios.map((s) => s.id), ["a-scenario", "b-scenario"]);
    },
  );
});

test("loadScenarios: throws when a fixture's id does not match its file name", () => {
  withScenariosDir({ "mismatched.json": JSON.stringify({ id: "different-id", confirmedProblems: [], expect: {} }) }, (dir) => {
    assert.throws(() => loadScenarios(dir), /must equal its file name/);
  });
});

test("loadScenarios: throws with the file name on invalid JSON", () => {
  withScenariosDir({ "broken.json": "{ not json" }, (dir) => {
    assert.throws(() => loadScenarios(dir), /broken\.json is not valid JSON/);
  });
});

test("loadScenarios: throws when the directory does not exist", () => {
  assert.throws(() => loadScenarios("/nonexistent/path/for/sure"), /scenarios directory not found/);
});

// Review #1413 item 7: zero loaded scenarios must be an error (the caller
// turns this into an indeterminate, exit-2 report), never a silent pass.
test("loadScenarios: throws when the directory exists but holds no *.json fixture", () => {
  withScenariosDir({ "not-json.txt": "ignored", "also-not-json.md": "ignored" }, (dir) => {
    assert.throws(() => loadScenarios(dir), /no scenario fixtures/);
  });
});

test("loadScenarios: throws on a directory that is empty", () => {
  withScenariosDir({}, (dir) => {
    assert.throws(() => loadScenarios(dir), /no scenario fixtures/);
  });
});

// Review #1413, reviewer A's N3: SCENARIOS_DIR must be computed with
// fileURLToPath, not `new URL(...).pathname` (which percent-encodes, and
// so breaks on a checkout path containing a space). This is a coarse but
// direct regression check: a percent-encoded path would contain "%20"
// wherever this repository's own path happens to need escaping, or would
// simply differ from the real filesystem path node:path would produce.
test("SCENARIOS_DIR is a real, existing filesystem path (not percent-encoded)", () => {
  assert.ok(existsSync(SCENARIOS_DIR), `expected SCENARIOS_DIR to exist on disk: ${SCENARIOS_DIR}`);
  assert.ok(!SCENARIOS_DIR.includes("%"), `expected SCENARIOS_DIR to contain no percent-encoding: ${SCENARIOS_DIR}`);
});
