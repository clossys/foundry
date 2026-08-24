#!/usr/bin/env node
// Producer-side wrapper: derive the shipped bin target from controller's
// manifest, then validate the public neutral fixture through that target.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(root, "packages/controller");
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const entry = manifest.bin?.["foundry-completion-evidence-check"];
if (typeof entry !== "string") throw new Error("@vespeneventures/controller does not declare foundry-completion-evidence-check");
const binTarget = join(packageRoot, entry);
if (!readFileSync(binTarget, "utf8").startsWith("#!/usr/bin/env node")) throw new Error("foundry-completion-evidence-check bin target must retain its Node shebang");
const result = spawnSync(process.execPath, [binTarget, join(root, "docs/contracts/completion-evidence.fixture.json"), join(root, "docs/contracts/installed-position-ledger.fixture.json")], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 2;
