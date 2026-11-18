/**
 * `advisor init`: after install, let Producer prepare the workspace. Advisor writes nothing itself here:
 * `clossys config --init` writes the workspace config when it is missing, then `clossys init` adds the
 * views pointer to AGENTS.md.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ok, refused, tail, type Host, type VerbResult } from "./host.js";
import { INSTALL_RECORD } from "./install.js";

export function clossysBin(root: string): string { return join(root, "node_modules", ".bin", "clossys"); }

export function runInit(root: string, host: Host): VerbResult {
  if (!existsSync(join(root, INSTALL_RECORD))) return refused([`init: no ${INSTALL_RECORD}; run advisor install --from <pack-dir> first`]);
  const bin = clossysBin(root);
  if (!existsSync(bin)) return refused(["init: node_modules/.bin/clossys is missing; run advisor update --from <pack-dir> to reinstall"]);
  const lines: string[] = [];
  if (!existsSync(join(root, "clossys", "clossys.config.ts"))) {
    const config = host.run(bin, ["config", "--init", "--root", root], { cwd: root });
    if (config.status !== 0) return refused([`init: clossys config --init failed (exit ${config.status ?? "none"}): ${tail(config.stderr || config.stdout)}`]);
    lines.push(`clossys config --init: ${tail(config.stdout, 1)}`);
  }
  const init = host.run(bin, ["init", "--root", root], { cwd: root });
  if (init.status !== 0) return refused([...lines, `init: clossys init failed (exit ${init.status ?? "none"}): ${tail(init.stderr || init.stdout)}`]);
  return ok([...lines, `clossys init: ${tail(init.stdout, 1)}`, "next: advisor intake --answers <file>"]);
}
