/** Run from repository root through wt run; each temporary mutation is restored in finally. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
const root = process.cwd();
const importer = resolve(root, "packages/designer/src/importers/foundry-components.ts");
const mapping = resolve(root, "packages/designer/src/importers/foundry-components.map.ts");
const mutants = [
  { id: "export-inventory", file: importer, from: "if (!target || !input.exports[target[1] as FoundryComponentSubpath].includes(target[2]!))", to: "if (!target)", test: "rejects nonexistent primary and alternate exports" },
  { id: "closed-members", file: importer, from: "if (!known || !mapping.propMap[member]?.trim())", to: "if (false)", test: "rejects invented, blank or orphaned member mappings" },
  { id: "regeneration", file: mapping, from: 'button: component("Button",', to: 'button: component("Badge",', test: "regenerates exactly" },
];
let failed = false;
for (const mutant of mutants) {
  const source = readFileSync(mutant.file, "utf8");
  if (!source.includes(mutant.from)) throw new Error(`Missing mutation anchor: ${mutant.id}`);
  try {
    writeFileSync(mutant.file, source.replace(mutant.from, mutant.to));
    const env = { ...process.env };
    delete env.UPDATE_FOUNDRY_COMPONENT_FILLS;
    const result = spawnSync(process.execPath, [resolve(root, "node_modules/vitest/vitest.mjs"), "run", "src/importers/foundry-components.test.ts", "--root", "packages/designer", "-t", mutant.test], { cwd: root, env, encoding: "utf8" });
    // A collection/runtime crash is not proof: require a completed, failing assertion test.
    const output = result.stdout + result.stderr;
    const killed = result.status === 1 && /AssertionError|expected.*to|to throw an error/i.test(output) && /1 failed/.test(output);
    console.log(`${mutant.id}: child=${result.status} ${killed ? "KILLED" : "NOT PROVEN"}`);
    if (!killed) { console.log(output.slice(-3000)); failed = true; }
  } finally { writeFileSync(mutant.file, source); }
}
process.exitCode = failed ? 1 : 0;
