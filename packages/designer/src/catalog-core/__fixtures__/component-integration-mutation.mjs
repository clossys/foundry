import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

// Run sequentially under wt resource admission. Mutate only facade-owned modules.
const root = new URL("../", import.meta.url);
const mutants = [
  ["public dispatch bypass", "api.ts", "isCompositeInput(input) ? checkComposite(input) : checkValues(input)", "isCompositeInput(input) ? {ok: true, findings: []} : checkValues(input)", "uses fresh consumer values"],
  ["whole hash omits components", "library-components.ts", "components: componentLibraryHash(owned.components)", 'components: "omitted"', "hashes every portion"],
  ["candidate values replace consumer values", "library-components.ts", "tokens: componentValues(values)", "tokens: componentValues(resolveValues({catalog: input.catalog.values, library: {source: input.library.source, fills: input.catalog.values.fills}}))", "dispatches public operations"],
  ["K and CC findings dropped", "library-components.ts", "findings.push(...componentProfile(input, values).check.findings)", "componentProfile(input, values)", "uses fresh consumer values"],
  ["emission ignores findings", "library-components.ts", "if (code && (", "if (false && (", "refuses emission on value or component errors"],
  ["source bundles lost", "library-components.ts", "}, cs.bundles);", "}, []);", "forwards verified source bundles"],
  ["asset key conversion lost", "library-components.ts", "const assetId = `assets.${leafKey}`;", "const assetId = leafKey;", "dispatches public operations"],
];
const digest = value => createHash("sha256").update(value).digest("hex");
const originals = new Map(mutants.map(([, module]) => { const path = fileURLToPath(new URL(module, root)); return [path, readFileSync(path, "utf8")]; }));
let passed = true;
for (const [name, module, before, after, title] of mutants) {
  const path = fileURLToPath(new URL(module, root));
  const original = originals.get(path);
  if (original.split(before).length !== 2) throw new Error(`Non-unique mutation anchor: ${name}`);
  try {
    writeFileSync(path, original.replace(before, after));
    const run = spawnSync("npx", ["vitest", "run", "src/catalog-core/component-integration.test.ts", "--root", "packages/designer", "--maxWorkers", "1", "-t", title], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024 });
    const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
    const killed = run.status === 1 && /AssertionError/.test(output) && /Tests\s+1 failed/.test(output);
    console.log(`${name}: ${killed ? "KILLED" : "INVALID_OR_SURVIVED"} exit=${run.status}`);
    if (!killed) { passed = false; console.log(output); }
  } finally {
    writeFileSync(path, original);
    if (digest(readFileSync(path, "utf8")) !== digest(original)) throw new Error(`Restore failed: ${name}`);
    console.log(`${name}: restored ${digest(original)}`);
  }
}
for (const [path, original] of originals) if (digest(readFileSync(path, "utf8")) !== digest(original)) throw new Error("Final exact-byte restore failed");
console.log(`mutants=${mutants.length} exact-byte-restoration=verified`);
if (!passed) process.exitCode = 1;
