import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GENERATED, evaluate, readSources, renderGenerated } from "./check-agents-definition.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const real = readSources(root);
const fresh = () => structuredClone(real);
const named = (findings) => findings.map((finding) => `${finding.rule} ${finding.subject}`);

test("the repository's agent declarations agree with agents.json", () => {
  assert.deepEqual(evaluate(fresh()), []);
});

test("a package with no agents.json row fails the definition check", () => {
  const sources = fresh();
  sources.agents.agents = sources.agents.agents.filter((row) => row.id !== "keeper");
  assert.ok(named(evaluate(sources)).includes("package-without-row keeper"));
});

test("a row with no package fails the definition check", () => {
  const sources = fresh();
  sources.agents.agents.push({ id: "ghost", package: "@clossys/ghost", class: "other", definitionOwner: "controller", rung: null });
  assert.ok(named(evaluate(sources)).includes("row-without-package ghost"));
});

test("a qualification entry naming a missing agent fails", () => {
  const sources = fresh();
  sources.policy["@clossys/ghost"] = { ...sources.policy["@clossys/keeper"], packageDir: "packages/ghost" };
  sources.adapters["@clossys/ghost"] = true;
  assert.deepEqual(named(evaluate(sources)), ["qualification-unknown-agent @clossys/ghost"]);
});

test("a qualification entry whose packageDir is not the agent's directory fails", () => {
  const sources = fresh();
  sources.policy["@clossys/keeper"] = { ...sources.policy["@clossys/keeper"], packageDir: "packages/keeper-old" };
  assert.deepEqual(named(evaluate(sources)), ["qualification-package-dir @clossys/keeper"]);
});

test("the role contract and agents.json agree", () => {
  const roleRules = new Set(["role-without-agent", "tooling-agent-has-role", "agent-without-role"]);
  assert.deepEqual(evaluate(fresh()).filter((finding) => roleRules.has(finding.rule)), []);
  const sources = fresh();
  delete sources.roleContract.roles["@clossys/keeper"];
  sources.roleContract.roles["@clossys/launcher"] = sources.roleContract.roles["@clossys/giver"];
  sources.roleContract.roles["@clossys/ghost"] = sources.roleContract.roles["@clossys/giver"];
  const findings = named(evaluate(sources)).filter((line) => roleRules.has(line.split(" ")[0]));
  assert.deepEqual(findings.sort(), ["agent-without-role @clossys/keeper", "role-without-agent @clossys/ghost", "tooling-agent-has-role @clossys/launcher"]);
});

test("Controller's copy of the role contract is the role contract, byte for byte", () => {
  const sources = fresh();
  sources.controllerCopyText = `${sources.controllerCopyText} `;
  assert.deepEqual(named(evaluate(sources)), ["controller-role-contract-drift packages/controller/contracts/role-loop-archetypes.json"]);
});

test("executable tooling in package evidence is exactly the tooling rows", () => {
  const sources = fresh();
  sources.agents.agents.find((row) => row.id === "producer").class = "content";
  const findings = named(evaluate(sources));
  assert.ok(findings.includes("evidence-class-mismatch @clossys/producer"));
  assert.ok(findings.includes("agent-without-role @clossys/producer"));
});

test("a generated copy that differs from agents.json by one byte fails", () => {
  const sources = fresh();
  const copy = sources.generated.find((item) => item.path === "packages/producer/src/agent-lists.generated.ts");
  copy.text = `${copy.text} `;
  assert.deepEqual(named(evaluate(sources)), ["generated-copy-drift packages/producer/src/agent-lists.generated.ts"]);
  const missing = fresh();
  missing.generated.find((item) => item.path === "packages/advisor/src/agent-lists.generated.ts").text = null;
  assert.deepEqual(named(evaluate(missing)), ["generated-copy-missing packages/advisor/src/agent-lists.generated.ts"]);
});

test("every generated copy is the render of agents.json", () => {
  for (const copy of real.generated) assert.equal(copy.text, renderGenerated(real.agents, copy.flavour), copy.path);
  assert.deepEqual(real.generated.map((copy) => copy.path), GENERATED.map((copy) => copy.path));
});

test("a named list naming a missing agent fails", () => {
  const sources = fresh();
  sources.agents.lists.nav.members.push("ghost");
  sources.agents.handoffs.pairs.push(["director", "ghost"]);
  const findings = named(evaluate(sources)).filter((line) => !line.startsWith("generated-copy-drift "));
  assert.deepEqual(findings, ["list-unknown-agent lists.nav", "handoff-unknown-agent handoffs.pairs[4]"]);
});

test("a named list naming an agent twice fails", () => {
  const sources = fresh();
  sources.agents.lists.trio.members.push("advisor");
  assert.deepEqual(named(evaluate(sources)).filter((line) => !line.startsWith("generated-copy-drift ")), ["list-duplicate-agent lists.trio"]);
});

test("the content list is exactly the content rows", () => {
  const sources = fresh();
  sources.agents.lists.content.members = sources.agents.lists.content.members.filter((id) => id !== "publisher");
  assert.deepEqual(named(evaluate(sources)).filter((line) => !line.startsWith("generated-copy-drift ")), ["content-list-drift lists.content"]);
  const missing = fresh();
  delete missing.agents.lists.content;
  assert.deepEqual(named(evaluate(missing)).filter((line) => !line.startsWith("generated-copy-drift ")), ["content-list-missing lists.content"]);
});

test("PACK_ROLES is read from agents.json", async () => {
  const { PACK_ROLES } = await import("../packages/producer/scripts/pack-five.mjs");
  assert.deepEqual([...PACK_ROLES], real.agents.lists.install.members);
  for (const path of ["packages/producer/scripts/pack-five.mjs", "packages/advisor/src/front-door/install.ts"]) {
    assert.match(readFileSync(`${root}${path}`, "utf8"), /export const PACK_ROLES = AGENT_LISTS\.install;/, path);
  }
});

test("a row outside the schema fails", () => {
  const sources = fresh();
  sources.agents.agents[0] = { ...sources.agents.agents[0], class: "role", extra: true };
  const findings = evaluate(sources).filter((finding) => finding.rule === "agents-schema").map((finding) => finding.subject);
  assert.deepEqual(findings, ["agents.json.agents[0].class", "agents.json.agents[0]"]);
});
