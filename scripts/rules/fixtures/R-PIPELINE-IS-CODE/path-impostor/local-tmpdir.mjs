// A local function named tmpdir that returns the working directory. Only os.tmpdir() imported
// from node:os is traced outside the repository, so this file must be reported. Never run.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

function tmpdir() { return process.cwd(); }

export function writeWorkspaceConfig(text) {
  writeFileSync(join(tmpdir(), "clossys/clossys.config.ts"), text);
}
