// os.tmpdir() reads TMPDIR: this file points it at the working directory first, so its
// "temp" write lands wherever it runs. A file that sets TMPDIR, TMP or TEMP gets no tmpdir()
// exemption and must be reported. Never run.
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function writeWorkspaceConfig(text) {
  process.env.TMPDIR = process.cwd();
  writeFileSync(join(tmpdir(), "clossys/clossys.config.ts"), text);
}
