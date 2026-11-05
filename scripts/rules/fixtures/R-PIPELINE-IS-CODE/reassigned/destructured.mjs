// The module-level base is os.tmpdir(), but the function declares its own base (in a list the
// declaration scan does not read as a plain const) and fills it by destructuring assignment. The
// traced const is shadowed, so the write is untraced and must be reported. Never run.
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = tmpdir();

export function writeWorkspaceConfig(text, options) {
  let label = "", base;
  ({ base } = options);
  writeFileSync(join(base, "clossys/clossys.config.ts"), `${label}${text}`);
}
