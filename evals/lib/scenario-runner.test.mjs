import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadScenarios } from "./scenario-runner.mjs";

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
