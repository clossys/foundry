import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { checkControllerRoleReadme, renderControllerRoleBlock } from "./check-controller-role-readme.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(readFileSync(join(repoRoot, "docs/contracts/role-loop-archetypes.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(repoRoot, "packages/controller/package.json"), "utf8"));
const readme = readFileSync(join(repoRoot, "packages/controller/README.md"), "utf8");
const input = { contract, manifest, readme, licenseExists: true };

test("Controller validates its canonical schema-v5 role alongside a strict README pointer", () => {
  assert.deepEqual(checkControllerRoleReadme(input), { ok: true });
});

test("only schema version 5 may validate the canonical Controller role", () => {
  for (const schemaVersion of [3, 4, undefined, 5.5, "5"]) {
    const changed = structuredClone(contract);
    if (schemaVersion === undefined) delete changed.schemaVersion;
    else changed.schemaVersion = schemaVersion;
    assert.throws(() => renderControllerRoleBlock(changed), /schemaVersion must be exactly 5/);
    assert.equal(checkControllerRoleReadme({ ...input, contract: changed }).ok, false);
  }
});

test("Controller refuses stale canonical stages and missing client-owned cadence", () => {
  const stages = structuredClone(contract);
  stages.universalStages[4] = "learnOrEscalate";
  assert.equal(checkControllerRoleReadme({ ...input, contract: stages }).ok, false);
  const bindings = structuredClone(contract);
  bindings.consumerBindings = bindings.consumerBindings.filter((binding) => binding !== "cadence");
  assert.equal(checkControllerRoleReadme({ ...input, contract: bindings }).ok, false);
});

for (const path of [
  ["jobQuestion"], ["metric", "name"], ["metric", "formula"], ["metric", "unit"],
  ["metric", "direction"], ["primaryMode"], ["secondaryModes"],
  ["boundary", "owns"], ["boundary", "excludes"], ["closeCondition"],
]) {
  test(`Controller refuses a malformed canonical ${path.join(".")}`, () => {
    const changed = structuredClone(contract);
    let parent = changed.roles[manifest.name];
    for (const key of path.slice(0, -1)) parent = parent[key];
    delete parent[path.at(-1)];
    const result = checkControllerRoleReadme({ ...input, contract: changed });
    assert.equal(result.ok, false);
    assert.match(result.reason, /canonical role contract is unreadable/);
  });
}

test("valid canonical secondary modes need no duplicate role prose in the README", () => {
  const changed = structuredClone(contract);
  changed.roles[manifest.name].secondaryModes = ["assure", "steward"];
  assert.deepEqual(checkControllerRoleReadme({ ...input, contract: changed }), { ok: true });
  assert.match(renderControllerRoleBlock(changed), /`assure`, `steward`/);
});

test("Controller refuses stale identity, install, docs, and license pointers", () => {
  for (const changed of [
    readme.replace(`# ${manifest.name}`, "# wrong-package"),
    readme.replace(`npm install ${manifest.name}`, "npm install wrong-package"),
    readme.replace("https://clossys.com/docs/controller", "https://clossys.com/docs/other"),
    readme.replace(" · [License](./LICENSE)", ""),
    renderControllerRoleBlock(contract),
  ]) assert.equal(checkControllerRoleReadme({ ...input, readme: changed }).ok, false);
  assert.equal(checkControllerRoleReadme({ ...input, licenseExists: false }).ok, false);
  assert.equal(checkControllerRoleReadme({ ...input, manifest: { ...manifest, name: "@gate-fixture/other" } }).ok, false);
});
