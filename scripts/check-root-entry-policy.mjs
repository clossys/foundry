import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policyPath = path.join(root, ".root-entry-policy.json");
const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
const listed = spawnSync("git", ["ls-files", "-z"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});

if (listed.status !== 0) {
  console.error(listed.stderr || "Unable to list tracked files.");
  process.exit(1);
}

const trackedRoots = new Set(
  listed.stdout
    .split("\0")
    .filter(Boolean)
    .map((file) => file.split("/")[0]),
);
const declaredRoots = new Set(Object.keys(policy.entries ?? {}));
const missing = [...trackedRoots].filter((entry) => !declaredRoots.has(entry)).sort();
const stale = [...declaredRoots].filter((entry) => !trackedRoots.has(entry)).sort();

if (policy.version !== 1 || missing.length || stale.length) {
  if (policy.version !== 1) console.error(`Unsupported root policy version: ${policy.version}`);
  if (missing.length) console.error(`Undeclared tracked root entries: ${missing.join(", ")}`);
  if (stale.length) console.error(`Declared root entries without tracked files: ${stale.join(", ")}`);
  process.exit(1);
}

console.log("Tracked repository-root entries match .root-entry-policy.json.");
