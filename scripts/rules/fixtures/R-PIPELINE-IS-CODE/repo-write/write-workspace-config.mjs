// Violation fixture for check:pipeline decide.foreign-writer (R-PIPELINE-IS-CODE): code outside the
// workspace.config step's declared entry that can write the decision file clossys/clossys.config.ts
// inside the repository. check:pipeline --scan on this directory must report it. Never run.
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

export function writeWorkspaceConfig(text) {
  writeFileSync(join(repo, "clossys/clossys.config.ts"), text);
}
