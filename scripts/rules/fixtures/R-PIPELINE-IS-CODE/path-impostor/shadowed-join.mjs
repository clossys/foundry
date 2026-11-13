// A local function named join that ignores its base: join(tmpdir(), ...) here lands in the
// working directory, not under os.tmpdir(). Only a join imported from node:path is traced, so
// check:pipeline --scan on this directory must report this file. Never run.
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const join = (_base, rel) => `${process.cwd()}/${rel}`;

export function writeWorkspaceConfig(text) {
  writeFileSync(join(tmpdir(), "clossys/clossys.config.ts"), text);
}
