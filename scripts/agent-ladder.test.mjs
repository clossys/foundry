// CP1-AGENTLADDER: the readiness ladder (scripts/lib/agent-ladder.mjs) computes each agent's rung from its rung
// checks, check:agent-rung:<rung> re-runs a rung's check for every agent the rungs file places at it, and the one
// scaffolder (scripts/scaffold-package.mjs) registers a package so it holds declared and conforming on day one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GENERATED } from "./check-agents-definition.mjs";
import { checkRung } from "./check-agent-rung.mjs";
import { RUNG_CHECKS, atOrAbove, computeLadder, renderRungs, shortfalls, ships, writeRungs } from "./lib/agent-ladder.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");
const real = (path) => readFileSync(join(repoRoot, path), "utf8");
const ladder = JSON.parse(real("docs/contracts/agents.json")).ladder;
const RUNGS = ladder.rungs.map((rung) => rung.id);

function world(t, { rows, lists = {} }) {
  const root = mkdtempSync(join(tmpdir(), "agent-ladder-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "docs/contracts"), { recursive: true });
  const agents = { schemaVersion: 2, agents: rows.map((id) => ({ id, package: `@clossys/${id}`, class: "other", definitionOwner: "controller" })), ladder, lists, handoffs: { description: "none", pairs: [] } };
  writeFileSync(join(root, "docs/contracts/agents.json"), `${JSON.stringify(agents, null, 2)}\n`);
  return root;
}

/** Checks that pass unless `fails[rung]` names the agent. */
const injected = (fails) => Object.fromEntries(RUNGS.map((rung) => [rung, (_context, row) => ((fails[rung] ?? []).includes(row.id) ? [`${rung} fails for ${row.id}`] : [])]));

test("the ladder is the five rungs, each with one check", () => {
  assert.deepEqual(RUNGS, ["declared", "conforming", "qualified", "packed", "looped"]);
  assert.deepEqual(Object.keys(RUNG_CHECKS), RUNGS);
});

test("an agent whose check fails cannot claim a higher rung", (t) => {
  const root = world(t, { rows: ["alpha", "beta", "gamma"] });
  // beta fails conforming but would pass every rung above it; gamma fails declared.
  const result = computeLadder(root, { checks: injected({ conforming: ["beta"], declared: ["gamma"] }) });
  const by = Object.fromEntries(result.agents.map((agent) => [agent.id, agent]));
  assert.equal(by.alpha.rung, "looped");
  assert.equal(by.alpha.next, null);
  assert.equal(by.beta.rung, "declared");
  assert.equal(by.beta.next, "conforming");
  assert.deepEqual(by.beta.missing, ["conforming fails for beta"]);
  assert.equal(by.gamma.rung, null);
  // A check that throws is a missing item, never a pass.
  const thrown = computeLadder(root, { checks: { ...injected({}), qualified: () => { throw new Error("boom"); } } });
  assert.ok(thrown.agents.every((agent) => agent.rung === "conforming" && /could not run: boom/.test(agent.missing[0])));
});

test("the install set is the agents at packed or higher", (t) => {
  const root = world(t, { rows: ["alpha", "beta", "gamma", "delta"], lists: { install: { description: "installed", members: ["alpha", "beta", "gamma"] } } });
  // alpha looped, beta packed, gamma qualified (fails packed), delta qualified and not listed.
  const result = computeLadder(root, { checks: injected({ packed: ["gamma", "delta"], looped: ["beta"] }) });
  assert.deepEqual(atOrAbove(result, "packed"), ["alpha", "beta"]);
  assert.deepEqual(shortfalls(result).map((item) => [item.id, item.need, item.rung]), [["gamma", "packed", "qualified"]]);
  const rungs = JSON.parse(renderRungs(result));
  assert.deepEqual(rungs.needs.install, { need: "packed", listed: 3, atOrAbove: 2 });
});

test("check:agent-rung fails an agent the rungs file places above what its check gives", (t) => {
  const root = world(t, { rows: ["alpha", "beta"] });
  writeRungs(root, computeLadder(root, { checks: injected({}) }));
  assert.equal(checkRung(root, "packed", { checks: injected({}) }).exitCode, 0);
  const failed = checkRung(root, "packed", { checks: injected({ packed: ["beta"] }) });
  assert.equal(failed.exitCode, 1);
  assert.match(failed.lines.join("\n"), /^FAIL packed beta: packed fails for beta$/m);
  assert.equal(checkRung(root, "nonesuch").exitCode, 2);
});

test("ships reads npm files: listed paths, folders, globs and negations", () => {
  assert.equal(ships(undefined, "skill/SKILL.md"), true);
  assert.equal(ships(["dist", "skill"], "skill/SKILL.md"), true);
  assert.equal(ships(["dist/**/*.js"], "./dist/cli/index.js"), true);
  assert.equal(ships(["dist", "!dist/cli"], "dist/cli/index.js"), false);
  assert.equal(ships(["dist"], "skill/SKILL.md"), false);
});

/**
 * A standalone world holding Controller (the canonical envelope source the scaffold renders from), Director (so
 * the rename table names a row) and the contracts the declared and conforming checks read; the scaffold adds probe.
 */
function scaffoldWorld(t) {
  const root = mkdtempSync(join(tmpdir(), "agent-ladder-scaffold-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(join(repoRoot, "docs/contracts"), join(root, "docs/contracts"), { recursive: true });
  writeFileSync(join(root, "package-scope.json"), real("package-scope.json"));
  const ids = ["controller", "director"];
  const write = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`); };
  const contract = JSON.parse(real("docs/contracts/role-loop-archetypes.json"));
  contract.roles = { "@clossys/controller": contract.roles["@clossys/controller"], "@clossys/director": contract.roles["@clossys/director"], "@clossys/probe": contract.roles["@clossys/advisor"] };
  write("docs/contracts/role-loop-archetypes.json", contract);
  const agents = JSON.parse(real("docs/contracts/agents.json"));
  agents.agents = agents.agents.filter((row) => ids.includes(row.id));
  const content = agents.agents.filter((row) => row.class === "content").map((row) => row.id);
  agents.lists = { content: { description: "content rows", members: content }, install: { description: "installed", members: ["controller"] } };
  agents.handoffs = { description: "none", pairs: [] };
  write("docs/contracts/agents.json", `{\n  "schemaVersion": 2,\n  "agents": [\n${agents.agents.map((row) => `    ${JSON.stringify(row).replace(/":/g, "\": ").replace(/,"/g, ", \"").replace(/^\{/, "{ ").replace(/\}$/, " }")}`).join(",\n")}\n  ],\n  "ladder": ${JSON.stringify(agents.ladder)},\n  "lists": ${JSON.stringify(agents.lists)},\n  "handoffs": ${JSON.stringify(agents.handoffs)}\n}\n`);
  write("docs/contracts/package-evidence.json", { schemaVersion: 1, packages: ids.map((id) => ({ name: `@clossys/${id}`, state: "implemented" })) });
  write("docs/contracts/package-lifecycle.json", { schemaVersion: 1, packages: ids.map((id) => ({ name: `@clossys/${id}`, status: "active" })) });
  write("docs/contracts/first-wave-sequence.json", { schemaVersion: 1, waves: [{ id: "only", packages: [...ids] }] });
  const policy = JSON.parse(real("governance/release-qualification-policy.json"));
  policy.packages = Object.fromEntries(Object.entries(policy.packages).filter(([, entry]) => ids.some((id) => entry.packageDir === `packages/${id}`)));
  write("governance/release-qualification-policy.json", `${JSON.stringify(policy, null, 2)}\n`);
  for (const entry of Object.values(policy.packages)) write(entry.adapterPath, real(entry.adapterPath));
  write("packages/controller/package.json", { name: "@clossys/controller", version: "0.0.0" });
  write("packages/controller/skill/SKILL.md", "---\nname: clossys-controller\n---\n");
  for (const path of ["src/envelope.ts", "src/gates/result.ts"]) write(`packages/controller/${path}`, real(`packages/controller/${path}`));
  for (const copy of GENERATED) mkdirSync(dirname(join(root, copy.path)), { recursive: true });
  mkdirSync(join(root, "packages/controller/contracts"), { recursive: true });
  return root;
}

test("a scaffolded agent passes declared and conforming on day one", (t) => {
  const root = scaffoldWorld(t);
  execFileSync(process.execPath, [join(scriptDir, "scaffold-package.mjs"), "probe", "--root", root], { stdio: "pipe" });
  const checks = { declared: RUNG_CHECKS.declared, conforming: RUNG_CHECKS.conforming };
  const probe = computeLadder(root, { checks }).agents.find((agent) => agent.id === "probe");
  assert.deepEqual(probe.missing, ["no check for rung qualified"], `probe misses: ${probe.missing.join("; ")}`);
  assert.equal(probe.rung, "conforming");
  const skill = readFileSync(join(root, "packages/probe/skill/SKILL.md"), "utf8");
  assert.match(skill, /^disable-model-invocation: true$/m);
});
