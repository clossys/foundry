// As ./destructured.mjs, filled by a for...of loop target instead. Never run.
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = tmpdir();

export function writeWorkspaceConfigs(text, roots) {
  let label = "", base;
  for (base of roots) writeFileSync(join(base, "clossys/clossys.config.ts"), `${label}${text}`);
}
