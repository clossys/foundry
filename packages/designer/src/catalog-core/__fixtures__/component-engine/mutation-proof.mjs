import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

// Sequential scoped proof, run under the worktree kit's resource admission.
// Every mutation is restricted to the three owned CL7 modules and restored byte-for-byte.
const root = new URL("../../", import.meta.url);
const mutants = [
  ["identifier guard", "resolve-components.ts", 'if (!/^[A-Z][A-Za-z0-9]*$/.test(value))', "if (false)", "emit-components.test.ts", "identifier guard rejects"],
  ["specifier guard", "resolve-components.ts", 'if (!/^(?:@[a-z0-9][a-z0-9-]*\\/[a-z0-9][a-z0-9-]*|[a-z0-9][a-z0-9-]*)(?:\\/[a-zA-Z0-9][a-zA-Z0-9_-]*)*$/.test(value))', "if (false)", "emit-components.test.ts", "specifier guard rejects"],
  ["upstream hash", "changeset-components.ts", "sha256(matches[0]!.content) !== pin.sha256", "false", "changeset-components.test.ts", "rejects unsafe, missing and unsupported source bundles"],
  ["output hash", "resolve-components.ts", "sha256(file.content) !== receipt.sha256", "false", "changeset-components.test.ts", "rejects unsafe, missing and unsupported source bundles"],
  ["blocked materialization", "resolve-components.ts", "if (fill.blockers?.length)", "if (false)", "changeset-components.test.ts", "rejects unsafe, missing and unsupported source bundles"],
];
let passed = true;
for (const [name, module, before, after, test, title] of mutants) {
  const path = fileURLToPath(new URL(module, root));
  const original = readFileSync(path, "utf8");
  const digest = value => createHash("sha256").update(value).digest("hex");
  if (original.split(before).length !== 2) throw new Error(`Non-unique mutation anchor: ${name}`);
  try {
    writeFileSync(path, original.replace(before, after));
    const run = spawnSync("npx", ["vitest", "run", `src/catalog-core/${test}`, "--root", "packages/designer", "-t", title], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 4 * 1024 * 1024 });
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
if (!passed) process.exitCode = 1;
