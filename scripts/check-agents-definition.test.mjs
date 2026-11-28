import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluate, extractList, readSources } from "./check-agents-definition.mjs";

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

test("a content list in code that drifts from the content rows fails", () => {
  const sources = fresh();
  const list = sources.codeLists.find((item) => item.symbol === "SLOT_AGENTS");
  list.members = [...list.members, "producer"];
  assert.deepEqual(named(evaluate(sources)), ["code-list-content-drift packages/producer/src/records/slot-model/types.ts#SLOT_AGENTS"]);
});

test("written-out lists are read in each of their shapes", () => {
  assert.deepEqual(extractList('export const A: readonly X[] = ["b", "c"] as const;', { symbol: "A" }), ["b", "c"]);
  assert.deepEqual(extractList('const A = Object.freeze(["b"]);', { symbol: "A" }), ["b"]);
  assert.deepEqual(extractList("const A = {\n  b: [1],\n  c: [2],\n} as const;", { symbol: "A", shape: "keys" }), ["b", "c"]);
  assert.deepEqual(extractList("const A = /^(b|c)\\/x$/;", { symbol: "A", shape: "alternation" }), ["b", "c"]);
  assert.equal(extractList("const B = [];", { symbol: "A" }), null);
});

test("a row outside the schema fails", () => {
  const sources = fresh();
  sources.agents.agents[0] = { ...sources.agents.agents[0], class: "role", extra: true };
  const findings = evaluate(sources).filter((finding) => finding.rule === "agents-schema").map((finding) => finding.subject);
  assert.deepEqual(findings, ["agents.json.agents[0].class", "agents.json.agents[0]"]);
});
