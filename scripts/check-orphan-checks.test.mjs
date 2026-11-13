import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { commandList, globRegExp, isGoverned, knownFailing, orphanFindings, reachable, simpleCommands } from "./check-orphan-checks.mjs";

/** A throwaway repository: { "path": "contents" }; objects are written as JSON. */
function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "orphan-checks-"));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof contents === "string" ? contents : JSON.stringify(contents, null, 2));
  }
  return root;
}
const rootManifest = scripts => ({ name: "fixture", private: true, workspaces: ["packages/*", "packages/designer/ui"], scripts });
const rules = result => result.findings.map(finding => `${finding.rule} ${finding.file}`);

test("governs check scripts, scripts/*check*, checks/ scripts and tests under producer and designer only", () => {
  for (const path of ["packages/producer/scripts/check-a.mjs", "packages/designer/scripts/emit-check-inputs.mjs", "packages/producer/studio/checks/dom.mjs",
    "packages/designer/ui/a.test.tsx", "packages/producer/studio/lib/b.test.ts", "packages/designer/src/x/check-y.cjs"]) assert.equal(isGoverned(path), true, path);
  for (const path of ["packages/writer/scripts/check-a.mjs", "scripts/check-a.mjs", "packages/designer/scripts/check-a.d.ts", "packages/designer/src/x/check-y.ts",
    "packages/designer/src/__fixtures__/check-a.mjs", "packages/producer/node_modules/x/check-a.mjs", "packages/designer/src/a.test.json", "packages/designer/scripts/build.mjs"]) assert.equal(isGoverned(path), false, path);
});

test("splits POSIX command lists and keeps quoted words whole", () => {
  assert.deepEqual(simpleCommands(`set -- a/; [ -d "$1" ] || exit 0; npm run test --workspaces && node "x y.mjs" | cat`),
    [["set", "--", "a/"], ["[", "-d", "$1", "]"], ["exit", "0"], ["npm", "run", "test", "--workspaces"], ["node", "x y.mjs"], ["cat"]]);
  assert.equal(globRegExp("src/**/*.test.{ts,tsx}").test("src/a/b.test.tsx"), true);
  assert.equal(globRegExp("src/**/*.test.{ts,tsx}").test("src/b.test.ts"), true);
  assert.equal(globRegExp("src/**/*.test.{ts,tsx}").test("studio/b.test.ts"), false);
});

test("a step after an && that cannot succeed is not reached; the root check aggregate reaches every step (gate F6)", async () => {
  assert.deepEqual(commandList("a && b || c; d | e").map(({ words, op }) => `${op} ${words.join(" ")}`), ["null a", "&& b", "|| c", "; d", "| e"]);
  const scripts = {
    check: "npm run gate && npm run check:a; false && npm run check:b | cat; false || npm run check:e; true || npm run check:f; node scripts/run-check-steps.mjs gate check:c check:studio --workspace=@x/producer",
    gate: "node scripts/gate.mjs", "check:a": "node scripts/a.mjs", "check:b": "node scripts/b.mjs", "check:c": "node scripts/c.mjs", "check:e": "node scripts/e.mjs", "check:f": "node scripts/f.mjs",
  };
  const root = tree({
    "package.json": rootManifest(scripts),
    "packages/producer/package.json": { name: "@x/producer", scripts: { "check:studio": "node scripts/s.mjs" } },
    ...Object.fromEntries(["gate", "a", "b", "c", "e", "f"].map(name => [`scripts/${name}.mjs`, ""])),
    "packages/producer/scripts/s.mjs": "",
  });
  try {
    const steps = graph => ["check:a", "check:b", "check:c", "check:e", "check:f"].filter(name => graph.scripts.has(`.#${name}`)).concat(graph.scripts.has("packages/producer#check:studio") ? ["studio"] : []);
    // gate may pass, so the step after it can run; `false &&` (and its pipeline) and `true ||` cannot.
    assert.deepEqual(steps(await reachable(root)), ["check:a", "check:c", "check:e", "studio"]);
    // A script known to fail every time: what follows its && is not reached, the aggregate still runs all.
    assert.deepEqual(steps(await reachable(root, { failing: new Set([".#gate"]) })), ["check:c", "check:e", "studio"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a check file nothing runs is an orphan; npm run, node --test, vitest include and imports reach files", async () => {
  const root = tree({
    "package.json": rootManifest({ check: "npm run check:a && npm run build", test: "npm run test --workspaces --if-present", "check:a": "node scripts/a.mjs", build: "tsc" }),
    "scripts/a.mjs": "",
    "packages/producer/package.json": { name: "@x/producer", scripts: { test: "vitest run", "check:studio": "node scripts/check-studio.mjs" } },
    "packages/producer/vitest.config.ts": `export default { test: { include: ["src/**/*.test.ts"] } }`,
    "packages/producer/src/a.test.ts": "import { x } from '../scripts/check-imported.mjs';",
    "packages/producer/scripts/check-imported.mjs": "",
    "packages/producer/scripts/check-studio.mjs": "",
    "packages/producer/studio/b.test.tsx": "",
    "packages/designer/package.json": { name: "@x/designer", scripts: { "test:x": "node --test scripts/x.test.mjs" } },
    "packages/designer/scripts/x.test.mjs": "",
    "packages/designer/ui/package.json": { name: "@x/designer-ui" },
    "packages/designer/ui/c.test.cjs": "",
  });
  try {
    const before = await orphanFindings(root);
    assert.deepEqual(rules(before), [
      "orphan packages/designer/scripts/x.test.mjs",
      "orphan packages/designer/ui/c.test.cjs",
      "orphan packages/producer/scripts/check-imported.mjs",
      "orphan packages/producer/scripts/check-studio.mjs",
      "orphan packages/producer/studio/b.test.tsx",
    ]);
    // Wire the aggregate into root check: its manifest commands, workspace flags and vitest configs count.
    writeFileSync(join(root, "package.json"), JSON.stringify(rootManifest({ check: "npm run check:studio --workspace=packages/producer", test: "npm run test --workspaces --if-present" })));
    writeFileSync(join(root, "packages/producer/scripts/check-studio.json"), JSON.stringify({ checks: [
      { cwd: "packages/designer", run: "npm run test:x" },
      { cwd: "packages/designer/ui", run: "node --test c.test.cjs" },
      { cwd: "packages/producer", run: "npx vitest run --config vitest.studio.config.ts" },
      { cwd: "packages/producer", run: "node scripts/check-imported.mjs" },
    ] }));
    writeFileSync(join(root, "packages/producer/vitest.studio.config.ts"), `export default { test: { include: ["studio/**/*.test.{ts,tsx}"] } }`);
    const after = await orphanFindings(root);
    assert.deepEqual(rules(after), []);
    assert.equal(after.reached, after.governed);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an exemption needs a one-line reason, a real governed file, and must still be an orphan", async () => {
  const root = tree({
    "package.json": rootManifest({ check: "node packages/producer/scripts/check-run.mjs", test: "true" }),
    "packages/producer/package.json": { name: "@x/producer" },
    "packages/producer/scripts/check-run.mjs": "",
    "packages/producer/scripts/check-migrate.mjs": "",
    "packages/producer/scripts/check-other.mjs": "",
    "scripts/check-orphan-checks.exemptions.json": { exemptions: [
      { file: "packages/producer/scripts/check-migrate.mjs", reason: "one-shot migrator of the retired cell store" },
      { file: "packages/producer/scripts/check-other.mjs", reason: "" },
      { file: "packages/producer/scripts/check-run.mjs", reason: "stale: root check runs it" },
      { file: "packages/producer/scripts/check-gone.mjs", reason: "moved" },
    ] },
  });
  try {
    assert.deepEqual(rules(await orphanFindings(root)).sort(), [
      "exemption-missing packages/producer/scripts/check-gone.mjs",
      "exemption-reason packages/producer/scripts/check-other.mjs",
      "exemption-stale packages/producer/scripts/check-run.mjs",
    ]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const steps = (graph, names) => names.filter(name => graph.scripts.has(`.#${name}`));
const checkScripts = names => Object.fromEntries(names.map(name => [name, `node scripts/${name.slice(6)}.mjs`]));

test("G7: an exit that runs ends the command list; only the path it did not take continues", async () => {
  const names = ["check:a", "check:b", "check:c", "check:d", "check:e", "check:f"];
  const root = tree({
    "package.json": rootManifest({
      check: "exit 1; npm run check:a",
      test: "npm run maybe || exit 0; npm run check:b; npm run maybe && exit 1; npm run check:c; true && exit 0; npm run check:d; exit 0 | cat; npm run check:e; false || exit 2 || npm run check:f",
      maybe: "node scripts/maybe.mjs", ...checkScripts(names),
    }),
    "scripts/maybe.mjs": "", ...Object.fromEntries(names.map(name => [`scripts/${name.slice(6)}.mjs`, ""])),
  });
  try {
    const graph = await reachable(root);
    // `exit 1;` ends check before check:a; `|| exit 0` and `&& exit 1` leave the other path open;
    // `true && exit 0` always exits, so nothing after it runs; a pipeline exit is a subshell.
    assert.deepEqual(steps(graph, names), ["check:b", "check:c"]);
    assert.deepEqual(steps(await reachable(root, { entries: [{ cwd: ".", run: "exit 0 | cat; npm run check:e; false || exit 2 || npm run check:f" }] }), names), ["check:e"]);
    // The status of a list that exits is the exit's: `exit 1; ...` can only fail.
    const after = tree({ "package.json": rootManifest({ check: "npm run gate && npm run check:a", gate: "exit 1; true", ...checkScripts(["check:a"]) }), "scripts/a.mjs": "" });
    try { assert.deepEqual(steps(await reachable(after), ["check:a"]), []); } finally { rmSync(after, { recursive: true, force: true }); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("G8: a missing npm script or workspace fails and is reported, unless --if-present", async () => {
  const root = tree({
    "package.json": rootManifest({ check: "npm run gone && npm run check:a; npm run check:b --workspace=@x/nobody; npm run lint --workspaces --if-present && npm run check:c", test: "true", ...checkScripts(["check:a", "check:b", "check:c"]) }),
    "packages/producer/package.json": { name: "@x/producer", scripts: {} },
    "packages/producer/scripts/check-a.mjs": "",
    ...Object.fromEntries(["a", "b", "c"].map(name => [`scripts/${name}.mjs`, ""])),
  });
  try {
    const graph = await reachable(root);
    assert.deepEqual(steps(graph, ["check:a", "check:b", "check:c"]), ["check:c"]);
    assert.deepEqual([...graph.missing].sort(), [".#gone", "@x/nobody#check:b"]);
    assert.deepEqual(rules(await orphanFindings(root)).filter(row => row.startsWith("missing-script")), ["missing-script .#gone", "missing-script @x/nobody#check:b"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("G9: a check only a reached test imports is not run, so it is an orphan", async () => {
  const root = tree({
    "package.json": rootManifest({ check: "node --test packages/producer/scripts/check-x.test.mjs", test: "node packages/producer/scripts/check-run.mjs" }),
    "packages/producer/package.json": { name: "@x/producer" },
    "packages/producer/scripts/check-x.test.mjs": "import './check-x.mjs';",
    "packages/producer/scripts/check-x.mjs": "import './lib/helper.mjs';",
    "packages/producer/scripts/lib/helper.mjs": "",
    "packages/producer/scripts/check-run.mjs": "import './check-lib.mjs';",
    "packages/producer/scripts/check-lib.mjs": "",
  });
  try {
    const graph = await reachable(root);
    assert.equal(graph.reached.has("packages/producer/scripts/check-x.mjs"), true, "still reached, for overlays and fixture tracing");
    assert.equal(graph.executed.has("packages/producer/scripts/check-x.mjs"), false);
    assert.equal(graph.executed.has("packages/producer/scripts/check-lib.mjs"), true, "an executed check's import runs");
    assert.deepEqual(rules(await orphanFindings(root)), ["orphan packages/producer/scripts/check-x.mjs"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("G10: check:rules is traced as failing while the registry has a rule that is not enforced", async () => {
  const rule = status => ({ id: "R-A", status });
  const root = tree({
    "package.json": rootManifest({ check: "npm run check:rules && node packages/producer/scripts/check-after.mjs", test: "true", "check:rules": "node scripts/check-rules.mjs" }),
    "scripts/check-rules.mjs": "",
    "packages/producer/package.json": { name: "@x/producer" },
    "packages/producer/scripts/check-after.mjs": "",
    "scripts/rules/registry.json": { rules: [rule("enforced"), { id: "R-B", status: "unenforced" }] },
  });
  try {
    assert.deepEqual([...knownFailing(root)], [".#check:rules"]);
    assert.deepEqual(rules(await orphanFindings(root)), ["orphan packages/producer/scripts/check-after.mjs"]);
    writeFileSync(join(root, "scripts/rules/registry.json"), JSON.stringify({ rules: [rule("enforced")] }));
    assert.deepEqual([...knownFailing(root)], []);
    assert.deepEqual(rules(await orphanFindings(root)), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
