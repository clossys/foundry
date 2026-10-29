/** Root-scoped, optimistic writes with an exclusive writer lock and rollback. */
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

export interface Change { path: string; before?: string; after: string }
export function safePath(root: string, path: string): string {
  const base = resolve(root), target = resolve(base, path), rel = relative(base, target);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Write path escapes the strategy root");
  // Refuse symbolic links in all existing components, including the root itself.
  let cursor = resolve(base, "..");
  for (const part of [base.slice(cursor.length + (cursor.endsWith(sep) ? 0 : 1)), ...rel.split(sep)]) {
    cursor = join(cursor, part);
    try {
      if (lstatSync(cursor).isSymbolicLink()) throw new Error("Strategy writes refuse symbolic links");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return target;
}
export function readBytes(root: string, path: string): string | undefined {
  const file = safePath(root, path);
  let fd: number | undefined;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = fstatSync(fd);
    if (!opened.isFile()) throw new Error("Expected a regular strategy file");
    const current = lstatSync(safePath(root, path));
    if (opened.dev !== current.dev || opened.ino !== current.ino) throw new Error("Strategy file changed during confinement checks");
    return readFileSync(fd, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  } finally { if (fd !== undefined) closeSync(fd); }
}
export function withWriteLock<T>(root: string, action: () => T): T {
  const lock = safePath(root, ".strategist-write.lock");
  try { mkdirSync(lock); } catch { throw new Error("Strategy root is unavailable or another write is in progress"); }
  try { return action(); } finally { rmSync(lock, { recursive: true, force: true }); }
}
export function commitChanges(root: string, changes: Change[]): void {
  if (new Set(changes.map(c => c.path)).size !== changes.length) throw new Error("Duplicate transaction path");
  const stage = `.strategist-write-${randomUUID()}`;
  const stageDir = safePath(root, stage);
  mkdirSync(stageDir);
  const applied: Change[] = [];
  try {
    changes.forEach((change, i) => {
      if (readBytes(root, change.path) !== change.before) throw new Error(`Strategy file changed during write: ${change.path}`);
      writeFileSync(join(stageDir, String(i)), change.after, { flag: "wx" });
    });
    changes.forEach((change, i) => {
      if (readBytes(root, change.path) !== change.before) throw new Error(`Strategy file changed during write: ${change.path}`);
      const target = safePath(root, change.path);
      mkdirSync(dirname(target), { recursive: true });
      renameSync(join(stageDir, String(i)), target);
      applied.push(change);
    });
  } catch (error) {
    for (const change of applied.reverse()) {
      const target = safePath(root, change.path);
      if (change.before === undefined) rmSync(target); else writeFileSync(target, change.before);
    }
    throw error;
  } finally { rmSync(stageDir, { recursive: true, force: true }); }
}
/** Edit only frontmatter metadata; leave the body's bytes and line endings intact. */
export function metadata(text: string, fields: Record<string, string | undefined>): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/.exec(text);
  if (!match) throw new Error("Cell frontmatter is missing");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  let lines = match[1]!.split(/\r?\n/);
  for (const [key, value] of Object.entries(fields)) {
    const i = lines.findIndex(line => line.startsWith(`${key}:`));
    if (value === undefined) { if (i !== -1) lines.splice(i, 1); }
    else if (i === -1) lines.push(`${key}: ${value}`);
    else lines[i] = `${key}: ${value}`;
  }
  return ["---", ...lines, "---"].join(newline) + text.slice(match[0].length);
}
