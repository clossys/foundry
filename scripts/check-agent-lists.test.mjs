import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { GENERATED_OUTPUTS, TEST_OR_FIXTURE, evaluate, findLists, readSources } from "./check-agent-lists.mjs";
import { GENERATED } from "./check-agents-definition.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const real = readSources(root);
const ids = real.ids;
const kinds = (path, text) => findLists(path, text, ids).map((item) => `${item.line} ${item.kind} ${item.members.join(",")}`);

test("no source file of the repository writes out an agent list", () => {
  assert.deepEqual(evaluate(real), []);
});

test("a hard-coded agent list fails the agent-lists check", () => {
  const files = [
    { path: "packages/producer/src/loop/new.ts", text: 'export const LIVE = ["director", "designer", "writer"] as const;\n' },
    { path: "packages/producer/src/types/new.ts", text: 'export type Agent = "designer" | "writer";\n' },
    { path: "packages/producer/src/check/new.ts", text: "const REF = /^(director|designer|writer|publisher)\\/[a-z]+$/;\n" },
    { path: "packages/producer/scripts/new.mjs", text: 'const SOURCE = "(?:writer|publisher)";\nconst TAIL = `^agents/${x}/(?:designer|producer)$`;\n' },
  ];
  const findings = evaluate({ ids, files });
  assert.deepEqual(findings.map((item) => item.subject), [
    "packages/producer/src/loop/new.ts:1",
    "packages/producer/src/types/new.ts:1",
    "packages/producer/src/check/new.ts:1",
    "packages/producer/scripts/new.mjs:1",
    "packages/producer/scripts/new.mjs:2",
  ]);
  assert.ok(findings.every((item) => item.rule === "agent-list"));
  assert.match(findings[0].message, /^array of agent ids director, designer, writer written out; read a named list of docs\/contracts\/agents\.json/);
  assert.equal(kinds("a.ts", 'type A = "designer" | "writer";')[0], "1 union designer,writer");
  assert.equal(kinds("a.ts", "const A = /^(?:director|writer):/;")[0], "1 regex director,writer");
});

test("PACK_ROLES written out fails the agent-lists check", () => {
  const files = real.files.map((file) => file.path === "packages/producer/scripts/pack-five.mjs"
    ? { ...file, text: file.text.replace("export const PACK_ROLES = AGENT_LISTS.install;", 'export const PACK_ROLES = ["controller", "director", "designer", "writer", "publisher", "producer", "advisor"];') }
    : file);
  assert.notDeepEqual(files, real.files, "pack-five.mjs reads PACK_ROLES from AGENT_LISTS.install");
  assert.deepEqual(evaluate({ ids, files }).map((item) => item.subject.replace(/:\d+$/, "")), ["packages/producer/scripts/pack-five.mjs"]);
});

test("a list with a member that is not an agent, or one agent only, is not an agent list", () => {
  assert.deepEqual(kinds("a.ts", 'const A = ["owner", "director", "designer"];'), []);
  assert.deepEqual(kinds("a.ts", 'const A = ["director", "director"];'), []);
  assert.deepEqual(kinds("a.ts", "const A = /^(?:finding|evidence|director):/;"), []);
  assert.deepEqual(kinds("a.ts", "const A = { director: 1, designer: 2 };"), []);
  assert.deepEqual(kinds("a.ts", "const A = `^(${AGENT_LISTS.live.join(\"|\")})/`;"), []);
});

test("the generated outputs are exactly the generated copies of agents.json; test and fixture files hold expected values", () => {
  assert.deepEqual([...GENERATED_OUTPUTS], GENERATED.map((copy) => copy.path));
  const scanned = new Set(real.files.map((file) => file.path));
  for (const path of GENERATED_OUTPUTS) assert.ok(!scanned.has(path), path);
  assert.ok(scanned.has("packages/producer/scripts/pack-five.mjs"));
  assert.ok(TEST_OR_FIXTURE.test("packages/producer/src/loop/names.test.ts"));
  assert.ok(TEST_OR_FIXTURE.test("scripts/rules/fixtures/R-AGENT-LISTS/src/lists.mjs"));
  assert.ok(!TEST_OR_FIXTURE.test("packages/producer/src/loop/names.ts"));
});
