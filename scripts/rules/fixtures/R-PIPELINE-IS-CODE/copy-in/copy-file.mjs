// A decision file staged under os.tmpdir() and copied to a destination that does not spell its
// name. The copy lands at the destination, which is not traced outside the repository, so this
// file must be reported. Never run.
import { copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function adoptWorkspaceConfig(target) {
  copyFileSync(join(tmpdir(), "clossys/clossys.config.ts"), target);
}
