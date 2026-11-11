// Mutation proofs for check:step-standard: the real registry passes, a copy of it passes, and breaking
// each rule once in the copy makes the check exit 1 naming that rule. Run after the build (dist).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { PACKAGES, packageSkills, PKG, REPO } from "./action-registry.mjs";

const CHECK = join(PKG, "scripts", "check-step-standard.mjs");
const DIST = join(PKG, "dist", "pipeline");
const run = (...args) => {
  const result = spawnSync(process.execPath, [...process.execArgv, CHECK, "--json", ...args], { encoding: "utf8" });
  let parsed = { failures: [], pending: [] };
  try { parsed = JSON.parse(result.stdout); } catch { /* reported by the assertion below */ }
  return { status: result.status, rules: new Set(parsed.failures.map(row => row.rule)), failures: parsed.failures, stderr: result.stderr };
};

/** A copy of every package's registry, package.json, skill files and the generated files. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "step-standard-"));
  const packages = join(root, "packages");
  for (const pkg of PACKAGES) {
    const from = join(REPO, "packages", pkg);
    const to = join(packages, pkg);
    mkdirSync(to, { recursive: true });
    copyFileSync(join(from, "package.json"), join(to, "package.json"));
    cpSync(join(from, "actions"), join(to, "actions"), { recursive: true });
    for (const skill of packageSkills(join(REPO, "packages"), pkg)) {
      mkdirSync(dirname(join(to, skill)), { recursive: true });
      copyFileSync(join(from, skill), join(to, skill));
    }
  }
  mkdirSync(join(packages, "producer", "pipeline"), { recursive: true });
  for (const file of ["actions.json", "manifest.json"]) copyFileSync(join(PKG, "pipeline", file), join(packages, "producer", "pipeline", file));
  const at = (...parts) => join(packages, ...parts);
  const edit = (path, change) => { const value = JSON.parse(readFileSync(path, "utf8")); change(value); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); };
  const action = (pkg, id, change) => edit(at(pkg, "actions", id, "action.json"), change);
  const module = (name, body) => { const file = join(root, name); writeFileSync(file, body); return file; };
  return { root, packages, at, edit, action, module, done: () => rmSync(root, { recursive: true, force: true }) };
}
const bindings = (f, body) => ["--bindings", f.module("bindings.mjs", `import { BINDINGS as REAL } from ${JSON.stringify(pathToFileURL(join(DIST, "steps", "bindings.js")).href)};\nconst B = { ...REAL };\n${body}\nexport const BINDINGS = B;\n`)];

/** Break one rule in a fresh copy; the check must exit 1 and name the rule. */
function proves(rule, mutate) {
  test(`mutation: ${rule}`, () => {
    const f = fixture();
    try {
      const extra = mutate(f) ?? [];
      const result = run("--packages", f.packages, ...extra);
      assert.equal(result.status, 1, `${rule}: expected exit 1, got ${result.status}\n${result.stderr}`);
      assert.ok(result.rules.has(rule), `${rule} not reported; got ${[...result.rules].join(", ") || "nothing"}`);
    } finally { f.done(); }
  });
}

test("the real registry passes", () => {
  const result = run();
  assert.equal(result.status, 0, JSON.stringify(result.failures, null, 2) + result.stderr);
});
test("an unmutated copy of the registry passes", () => {
  const f = fixture();
  try {
    const result = run("--packages", f.packages);
    assert.equal(result.status, 0, JSON.stringify(result.failures, null, 2) + result.stderr);
  } finally { f.done(); }
});

proves("action.invalid", f => f.action("producer", "compile", c => { c.extra = true; }));
proves("action.folder", f => { writeFileSync(f.at("producer", "actions", "compile", "notes.txt"), "x"); });
proves("action.duplicate", f => { cpSync(f.at("producer", "actions", "compile"), f.at("designer", "actions", "compile"), { recursive: true }); });
proves("action.agent", f => f.action("director", "director.check", c => { c.agent = "writer"; }));
proves("action.manual", f => f.action("producer", "ia", c => { c.manual = "owner edits ia.json"; }));
proves("port.untyped", f => f.action("producer", "compile", c => { delete c.inputs[0].schema; }));
proves("port.schema-missing", f => f.action("producer", "compile", c => { c.outputs[0].schema = "no-such-schema"; }));
proves("run.invalid", f => f.action("producer", "compile", c => { c.run = "npm run build"; }));
proves("run.verb-unknown", f => f.action("producer", "workspace.check", c => { c.run = "clossys frobnicate"; }));
proves("run.trace-id", f => f.action("producer", "derive.uses", c => { c.run = c.run.replace("trace derive.uses", "trace studio.map"); }));
proves("run.untraced", f => f.action("producer", "studio.map", c => { c.run = "clossys pipeline trace studio.map -- bash generate.sh"; }));
proves("run.target-missing", f => f.action("producer", "studio.map", c => { c.run = "clossys pipeline trace studio.map -- npm run no-such-script"; }));
// writer.approve reverts to a gap awaiting `clossys pin`, which the pin.* actions already serve.
proves("gap.stale", f => f.action("producer", "writer.approve", c => { delete c.run; c.gap = { unit: "W6a", reason: "awaits a verb that has landed", awaits: "clossys pin writer/<slot>" }; }));
proves("chain.missing", f => f.action("designer", "designer.compile", c => { delete c.chain; }));
proves("chain.mismatch", f => f.action("designer", "designer.compile", c => { c.chain = "clossys design --check"; }));
proves("chain.invalid", f => f.action("producer", "ia", c => { c.chain = "clossys ia designer/hero --under a/b --contract x.json"; }));
proves("pass.invalid", f => f.action("producer", "compile", c => { c.pass.exit = { pass: [0, 1], fail: [], error: [2] }; }));
proves("pass.uncited", f => f.action("producer", "compile", c => { c.checks = ["workspace"]; }));
proves("check.unknown", f => f.action("producer", "compile", c => { c.checks.push("no-such-check"); }));
proves("record.invalid", f => f.action("producer", "compile", c => { c.record = "custom-record/1"; }));
proves("decide.incomplete", f => { rmSync(f.at("producer", "actions", "pin.director", "skill.md")); });
proves("packet.invalid", f => f.action("producer", "pin.director", c => { c.packet.checks.push("workspace"); }));
proves("uses.missing", f => f.action("director", "director.candidates", c => { c.uses.push("skill/no-such.md"); }));
proves("ia.invalid", f => f.edit(f.at("writer", "actions", "ia.json"), ia => { ia.nodes = "flat"; }));
proves("ia.placement", f => f.edit(f.at("writer", "actions", "ia.json"), ia => { ia.nodes[0].children[0].actions.shift(); }));
proves("binding.missing", f => bindings(f, `delete B["compile"];`));
proves("binding.orphan", f => bindings(f, `B["ghost.step"] = { entry: "src/cli/check.ts#runCheck" };`));
proves("binding.mismatch", f => bindings(f, `B["derive.uses"] = { script: "scripts/generate-studio-map.mjs" };`));
proves("binding.unresolved", f => bindings(f, `B["ia"] = { module: ["src/records/no-such.ts#nothing"] };`));
proves("handler.unknown", f => bindings(f, `B["workspace.check"] = { entry: "src/cli/check.ts#runCheckElsewhere" };`));
proves("handler.unbound", f => bindings(f, `B["decisions"] = { entry: "src/cli/check.ts#runCheck" };`));
proves("bin.unlisted", f => f.edit(f.at("writer", "package.json"), manifest => { manifest.bin = { ...manifest.bin, "writer-extra": "dist/extra.js" }; }));
proves("skill.unlisted", f => { writeFileSync(f.at("writer", "skill", "extra.md"), "# extra\n"); });
proves("exception.invalid", f => f.edit(f.at("writer", "actions", "exceptions.json"), list => { list.exceptions.push(list.exceptions[0]); }));
proves("exception.stale", f => f.edit(f.at("writer", "actions", "exceptions.json"), list => { list.exceptions.push({ item: "bin:writer-gone", reason: "gone", unit: "W3" }); }));
proves("snapshot.stale", f => f.action("producer", "compile", c => { c.summary = `${c.summary} (edited)`; }));
proves("manifest.stale", f => f.edit(f.at("producer", "pipeline", "manifest.json"), manifest => { manifest.agents.producer.steps.pop(); }));
proves("steps.drift", f => ["--steps", f.module("steps.mjs", `import { STEPS as REAL } from ${JSON.stringify(pathToFileURL(join(DIST, "steps", "index.js")).href)};\nexport const STEPS = [...REAL].reverse();\n`)]);
proves("step.hand-written", f => {
  const dir = join(f.root, "steps-src");
  cpSync(join(PKG, "src", "pipeline", "steps"), dir, { recursive: true });
  writeFileSync(join(dir, "extra.ts"), `import { defineStep } from "../define.js";\nexport const EXTRA = defineStep({} as never);\n`);
  return ["--steps-src", dir];
});
// A check still marked pending although its command (`clossys pipeline check`) exists in src/cli.
proves("pending.stale", f => {
  // Copy the whole dist: dist/pipeline imports ../records, ../cli and friends.
  cpSync(dirname(DIST), join(f.root, "dist"), { recursive: true });
  const dir = join(f.root, "dist", "pipeline");
  const checks = join(dir, "steps", "checks.js");
  copyFileSync(checks, join(dir, "steps", "checks.real.js"));
  writeFileSync(checks, `export * from "./checks.real.js";\nimport { CHECKS as REAL } from "./checks.real.js";\nexport const CHECKS = [...REAL, { ...REAL[0], command: "clossys pipeline check", pending: { branch: "claude/landed" } }];\n`);
  return ["--dist", dir];
});
proves("dist.missing", f => { const dir = join(f.root, "no-dist"); mkdirSync(dir); return ["--dist", dir]; });

