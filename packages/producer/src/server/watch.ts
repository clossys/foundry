import { watch, type FSWatcher } from "node:fs";
import { lstat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { AgentKind } from "../agents.js";
import { AGENT_KINDS, CELL_ID } from "./cells.js";
import type { ChangeEvent } from "./contract.js";

/** One recursive watcher per server, including when the agents directory is absent. */
export async function watchCells(root: string, onChange: (event: ChangeEvent) => void): Promise<() => void> {
  const target = join(resolve(root), "clossys", "agents");
  let watched = target;
  for (;;) {
    try {
      const stat = await lstat(watched);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Expected a regular cell directory");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(watched); if (parent === watched) throw error; watched = parent;
    }
  }
  let closed = false;
  const watcher: FSWatcher = watch(watched, { recursive: true }, (_type, filename) => {
    if (closed || filename === null) return;
    const changed = resolve(watched, String(filename));
    const rel = relative(target, changed);
    if (rel === ".." || rel.startsWith(`..${sep}`)) return;
    const [kind, directory, cell] = rel.split(sep);
    const agent = AGENT_KINDS.includes(kind as AgentKind) ? kind as AgentKind : null;
    const id = directory === "cells" && cell && CELL_ID.test(cell) ? cell : null;
    onChange({ agent, id, reload: true });
  });
  watcher.on("error", () => { if (!closed) onChange({ agent: null, id: null, reload: true }); });
  return () => { closed = true; watcher.close(); };
}
