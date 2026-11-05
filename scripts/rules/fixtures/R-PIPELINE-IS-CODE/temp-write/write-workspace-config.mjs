// Counterpart of ../repo-write: the same relative path, clossys/clossys.config.ts, written under
// os.tmpdir(). Its real path is outside the repository, so it is not a repository write and
// check:pipeline --scan on this directory must not report it. Never run.
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function writeWorkspaceConfig(text) {
  writeFileSync(join(tmpdir(), "clossys/clossys.config.ts"), text);
}
