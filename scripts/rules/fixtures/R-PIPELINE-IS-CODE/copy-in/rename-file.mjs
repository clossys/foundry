// The rename form of ./copy-file.mjs: moved, not copied, into an untraced destination. Never run.
import { renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function adoptWorkspaceConfig(target) {
  renameSync(join(tmpdir(), "clossys/clossys.config.ts"), target);
}
