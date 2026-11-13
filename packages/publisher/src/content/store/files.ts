import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

/** Record identities are filenames, never paths supplied by content. */
export function storeSegment(value: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new TypeError("Invalid store path segment");
  return value;
}

export async function storeRoot(input: string, create = false): Promise<string> {
  const root = resolve(input);
  if (create) await fs.mkdir(root, { recursive: true });
  const stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new TypeError("Store root must be a regular directory");
  return root;
}

async function entry(root: string, name: string, create = false): Promise<string> {
  const parts = name.split("/");
  if (parts.some(part => !part || part === "." || part === ".." || /[\\\u0000:]/.test(part))) throw new TypeError("Invalid store path");
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    if (create) await fs.mkdir(current).catch(error => { if (error.code !== "EEXIST") throw error; });
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new TypeError("Store ancestors must be regular directories");
  }
  return join(current, parts.at(-1)!);
}

export async function readStoreJson(root: string, name: string): Promise<unknown> {
  const file = await fs.open(await entry(root, name), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await file.stat()).isFile()) throw new TypeError("Store entry must be a regular file");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await file.readFile()));
  } finally { await file.close(); }
}

export async function storeEntries(root: string, name: string, kind: "file" | "directory"): Promise<string[]> {
  const path = await entry(root, `${name}/placeholder`);
  const entries = await fs.readdir(dirname(path), { withFileTypes: true });
  for (const value of entries) {
    if (kind === "file" ? !value.isFile() : !value.isDirectory()) throw new TypeError("Unexpected store entry kind");
  }
  return entries.map(value => value.name).sort();
}

export async function optionalStoreJson(root: string, name: string): Promise<unknown | undefined> {
  try { return await readStoreJson(root, name); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

export async function writeStoreJson(root: string, name: string, value: unknown, immutable: boolean): Promise<void> {
  const path = await entry(root, name, true);
  const bytes = JSON.stringify(value, null, 2) + "\n";
  if (immutable) {
    const file = await fs.open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW);
    try { await file.writeFile(bytes, "utf8"); } finally { await file.close(); }
    return;
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, bytes, { flag: "wx" });
    // Existing symlinks are refused rather than followed or silently replaced.
    try { if (!(await fs.lstat(path)).isFile()) throw new TypeError("Store entry must be a regular file"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await fs.rename(temporary, path);
  } finally { await fs.unlink(temporary).catch(() => undefined); }
}
