import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const runner = fileURLToPath(new URL("./regenerate.mjs", import.meta.url));
const run = mutant => spawnSync(process.execPath, [runner, "--probe", ...(mutant ? [`--mutant=${mutant}`] : [])], { encoding: "utf8" });
const baseline = run();
assert.equal(baseline.status, 0, baseline.stderr);
console.log("baseline=0");
for (const mutant of ["sha", "root", "blockers", "glyph"]) {
  const result = run(mutant);
  assert.equal(result.status, 1, `survived ${mutant}: ${result.stdout}${result.stderr}`);
  assert(result.stderr.includes(`${mutant}:`), `wrong failure for ${mutant}: ${result.stderr}`);
  console.log(`${mutant}=killed exit=${result.status}`);
}
