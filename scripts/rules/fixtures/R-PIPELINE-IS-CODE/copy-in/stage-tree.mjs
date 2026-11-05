// Writes the decision file into a scratch tree under os.tmpdir(), then copies the whole tree to
// a root it was given. Neither copy argument spells the decision file, but the tree carries it,
// so this file must be reported. Never run.
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const stage = mkdtempSync(join(tmpdir(), "stage-"));

export function adoptWorkspaceConfig(root, text) {
  writeFileSync(join(stage, "clossys/clossys.config.ts"), text);
  cpSync(stage, root, { recursive: true });
}
