import { dirname, normalize, resolve } from "node:path";
import type { FileStats, FileSystemPort } from "./types.js";

/**
 * An in-memory FileSystemPort for tests.
 *
 * This exists because the alternative -- exercising an installer against a real
 * home directory -- is a test that can damage the machine running it. Not
 * shipped; excluded from the published files and from the build.
 */

type Node =
  | { kind: "file"; contents: Uint8Array; mode: number }
  | { kind: "dir"; mode: number }
  | { kind: "symlink"; target: string; mode: number };

export interface MemoryFileSystem extends FileSystemPort {
  set(path: string, contents: string, mode?: number): void;
  setDirectory(path: string, mode?: number): void;
  setSymlink(path: string, target: string): void;
  read(path: string): string | undefined;
  paths(): string[];
  node(path: string): Node | undefined;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function createMemoryFileSystem(): MemoryFileSystem {
  const nodes = new Map<string, Node>();

  const key = (path: string): string => normalize(resolve(path));

  function ensureParents(path: string, mode = 0o755): void {
    let current = dirname(key(path));
    const seen: string[] = [];
    while (current !== dirname(current) && !nodes.has(current)) {
      seen.push(current);
      current = dirname(current);
    }
    for (const directory of seen.reverse()) nodes.set(directory, { kind: "dir", mode });
  }

  function resolveLinks(path: string, depth = 0): string | undefined {
    if (depth > 32) return undefined;
    const target = key(path);
    const node = nodes.get(target);
    if (node === undefined) {
      // A path under a symlinked directory still resolves, so walk the parent.
      const parent = dirname(target);
      if (parent === target) return undefined;
      const parentReal = resolveLinks(parent, depth + 1);
      if (parentReal === undefined || parentReal === parent) return undefined;
      return resolveLinks(`${parentReal}/${target.slice(parent.length + 1)}`, depth + 1);
    }
    if (node.kind === "symlink") return resolveLinks(node.target, depth + 1);
    return target;
  }

  return {
    set(path, contents, mode = 0o644) {
      ensureParents(path);
      nodes.set(key(path), { kind: "file", contents: encoder.encode(contents), mode });
    },
    setDirectory(path, mode = 0o755) {
      ensureParents(path);
      nodes.set(key(path), { kind: "dir", mode });
    },
    setSymlink(path, target) {
      ensureParents(path);
      nodes.set(key(path), { kind: "symlink", target: key(target), mode: 0o777 });
    },
    read(path) {
      const node = nodes.get(key(path));
      return node?.kind === "file" ? decoder.decode(node.contents) : undefined;
    },
    paths() {
      return [...nodes.keys()].sort();
    },
    node(path) {
      return nodes.get(key(path));
    },

    lstat(path): FileStats | undefined {
      const node = nodes.get(key(path));
      if (node === undefined) return undefined;
      return {
        isFile: node.kind === "file",
        isDirectory: node.kind === "dir",
        isSymbolicLink: node.kind === "symlink",
        mode: node.mode & 0o777,
      };
    },
    realpath(path) {
      return resolveLinks(path);
    },
    readFile(path) {
      const real = resolveLinks(path);
      const node = real === undefined ? undefined : nodes.get(real);
      if (node?.kind !== "file") throw new Error(`ENOENT: ${path}`);
      return node.contents;
    },
    writeFile(path, contents) {
      ensureParents(path);
      const existing = nodes.get(key(path));
      nodes.set(key(path), {
        kind: "file",
        contents,
        mode: existing?.kind === "file" ? existing.mode : 0o644,
      });
    },
    readlink(path) {
      const node = nodes.get(key(path));
      if (node?.kind !== "symlink") throw new Error(`EINVAL: ${path}`);
      return node.target;
    },
    symlink(target, path) {
      ensureParents(path);
      nodes.set(key(path), { kind: "symlink", target: key(target), mode: 0o777 });
    },
    mkdir(path, mode = 0o755) {
      ensureParents(path, mode);
      if (!nodes.has(key(path))) nodes.set(key(path), { kind: "dir", mode });
    },
    remove(path) {
      const target = key(path);
      const node = nodes.get(target);
      if (node?.kind === "dir") {
        for (const candidate of [...nodes.keys()]) {
          if (candidate === target || candidate.startsWith(`${target}/`)) nodes.delete(candidate);
        }
        return;
      }
      nodes.delete(target);
    },
    chmod(path, mode) {
      const target = key(path);
      const node = nodes.get(target);
      if (node === undefined) throw new Error(`ENOENT: ${path}`);
      nodes.set(target, { ...node, mode });
    },
    copy(from, to) {
      const source = key(from);
      const node = nodes.get(source);
      if (node === undefined) throw new Error(`ENOENT: ${from}`);
      ensureParents(to);
      if (node.kind !== "dir") {
        nodes.set(key(to), { ...node });
        return;
      }
      nodes.set(key(to), { ...node });
      for (const [candidate, value] of [...nodes.entries()]) {
        if (candidate.startsWith(`${source}/`)) {
          nodes.set(`${key(to)}${candidate.slice(source.length)}`, { ...value });
        }
      }
    },
  };
}
