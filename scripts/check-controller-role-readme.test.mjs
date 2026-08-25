import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { checkControllerRoleReadme, renderControllerRoleBlock } from "./check-controller-role-readme.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(readFileSync(join(repoRoot, "docs/contracts/role-loop-archetypes.json"), "utf8"));
const readme = readFileSync(join(repoRoot, "packages/controller/README.md"), "utf8");

test("Controller README role charter exactly matches the canonical schema-v4 role", () => {
  assert.deepEqual(checkControllerRoleReadme({ contract, readme }), { ok: true });
});

test("SEPARATING FIXTURE: a plausible README block with stale loop stages is rejected", () => {
  const stale = renderControllerRoleBlock(contract).replace("`learnOrEscalate`", "`learn`");
  assert.deepEqual(checkControllerRoleReadme({ contract, readme: stale }), {
    ok: false,
    reason: "README Controller role-contract block differs from docs/contracts/role-loop-archetypes.json",
  });
});

test("a missing client-owned setpoint or cadence is not rendered from an unreadable contract", () => {
  const withoutCadence = structuredClone(contract);
  withoutCadence.consumerBindings = withoutCadence.consumerBindings.filter((binding) => binding !== "cadence");
  assert.throws(() => renderControllerRoleBlock(withoutCadence), /setpoint and cadence/);
});
