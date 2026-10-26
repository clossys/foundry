import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

// Run from the repository root under wt resource admission. These intentional
// assertion failures prove the synthetic negative fixtures exercise each guard.
const target = fileURLToPath(new URL("../../check-components.ts", import.meta.url));
const original = readFileSync(target, "utf8");
const digest = value => createHash("sha256").update(value).digest("hex");
const mutants = [
  ["K2 accepts radix", "FORBIDDEN.test(module)", "false", "K2 rejects radix"],
  ["K7 ignores text glyph", "GLYPHS.test(file.code)", "false", "K7 rejects text glyphs"],
  ["CC2 skipped", 'add("K12", fill.slot, `Dependent ${call.target} breaks RAC context root/ref/render props`, "CC2");', "void 0;", "CC2 rejects a changed context"],
  ["CC3 skipped", 'add("K12", fill.slot, "RAC range, peer declaration or observed install differs from consumer singleton", "CC3");', "void 0;", "CC3 rejects a disjoint range"],
  ["cycle check off", "walk(slot, []);", "void slot;", "CC5 and K3 reject composes cycles"],
];
let allKilled = true;
try {
  for (const [name, before, after, test] of mutants) {
    if (original.split(before).length !== 2) throw new Error(`Mutation anchor is not unique: ${name}`);
    writeFileSync(target, original.replace(before, after));
    try {
      const run = spawnSync("npx", ["vitest", "run", "src/catalog-core/check-components.test.ts", "--root", "packages/designer", "-t", test], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 4 * 1024 * 1024 });
      const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
      const killed = run.status === 1 && /AssertionError/.test(output) && /Tests\s+1 failed/.test(output);
      console.log(`${name}: ${killed ? "KILLED" : "INVALID_OR_SURVIVED"} exit=${run.status}`);
      if (!killed) { allKilled = false; console.log(output); }
    } finally {
      writeFileSync(target, original);
      if (digest(readFileSync(target, "utf8")) !== digest(original)) throw new Error(`Source restore failed: ${name}`);
      console.log(`${name}: exact restore ${digest(original)}`);
    }
  }
} finally { writeFileSync(target, original); }
if (!allKilled) process.exitCode = 1;
