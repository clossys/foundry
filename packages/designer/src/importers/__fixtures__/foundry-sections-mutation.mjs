/** Run through wt run from repository root; mutations restore the source in finally. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const file = resolve(root, "packages/designer/src/importers/foundry-sections.ts");
const mutants = [
  { id: "section-export-inventory", from: "input.exports && !input.exports.includes(entry.export)", to: "input.exports && !input.exports.includes(input.exports[0] ?? entry.export)", test: "kills missing-export and invented-member mutants" },
  { id: "section-contract-members", from: "!allowed.includes(name) || !pointer?.trim()", to: "!pointer?.trim()", test: "kills missing-export and invented-member mutants" },
  { id: "section-regeneration", from: 'media: "media", actions: "actions"', to: 'media: "media"', test: "regenerates exactly" },
];
let failed = false;
for (const mutant of mutants) {
  const source = readFileSync(file, "utf8");
  if (!source.includes(mutant.from)) throw new Error(`Missing mutation anchor: ${mutant.id}`);
  try {
    writeFileSync(file, source.replace(mutant.from, mutant.to));
    const env = { ...process.env };
    delete env.UPDATE_FOUNDRY_SECTION_FILLS;
    const result = spawnSync(process.execPath, [resolve(root, "node_modules/vitest/vitest.mjs"), "run", "src/importers/foundry-sections.test.ts", "--root", "packages/designer", "-t", mutant.test], { cwd: root, env, encoding: "utf8" });
    const output = result.stdout + result.stderr;
    const killed = result.status === 1 && /AssertionError/.test(output) && /1 failed/.test(output);
    console.log(`${mutant.id}: child=${result.status} ${killed ? "KILLED" : "NOT PROVEN"}`);
    if (!killed) { console.log(output.slice(-3000)); failed = true; }
  } finally { writeFileSync(file, source); }
}
process.exitCode = failed ? 1 : 0;
