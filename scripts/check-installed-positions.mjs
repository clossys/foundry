#!/usr/bin/env node
// Producer-side wrapper. Resolve the package-declared bin rather than importing
// the CLI module: this exercises the packed bin mapping and its executable
// entry point just as a consumer does.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(root, "packages/controller");
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const entry = manifest.bin?.["foundry-position-check"];
if (typeof entry !== "string") throw new Error("@vespeneventures/controller does not declare foundry-position-check");
const binTarget = join(packageRoot, entry);
if (!readFileSync(binTarget, "utf8").startsWith("#!/usr/bin/env node")) {
  throw new Error("foundry-position-check bin target must retain its Node shebang");
}
// `bin` targets are not guaranteed executable in a source checkout. Run the
// target through Node while deriving it from the package's bin mapping; npm
// adds the executable shim for external consumers.
const result = spawnSync(process.execPath, [binTarget, ...process.argv.slice(2)], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 2;
