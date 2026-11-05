// Counterpart of ../copy-in: the decision file and the copy destination both stay under
// os.tmpdir(), so nothing reaches the repository and check:pipeline --scan on this directory
// must not report it. Never run.
import { copyFileSync, cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const stage = mkdtempSync(join(tmpdir(), "stage-"));
const backup = mkdtempSync(join(tmpdir(), "backup-"));

export function backupWorkspaceConfig(text) {
  writeFileSync(join(stage, "clossys/clossys.config.ts"), text);
  copyFileSync(join(tmpdir(), "clossys/clossys.config.ts"), join(tmpdir(), "previous.ts"));
  cpSync(stage, backup, { recursive: true });
}
