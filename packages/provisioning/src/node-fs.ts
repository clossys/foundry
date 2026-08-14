import {
  chmodSync,
  copyFileSync,
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import type { FileStats, FileSystemPort } from "./types.js";

/**
 * The default adapter: this engine's port, backed by the real filesystem.
 *
 * It is a separate module and a separate export so that importing the engine
 * never implies touching a disk. A caller wanting an audit log, a dry run, or a
 * sandboxed root wraps or replaces this, and the engine cannot tell.
 */
export function createNodeFileSystem(): FileSystemPort {
  return {
    lstat(path: string): FileStats | undefined {
      try {
        const stat = lstatSync(path);
        return {
          isFile: stat.isFile(),
          isDirectory: stat.isDirectory(),
          isSymbolicLink: stat.isSymbolicLink(),
          mode: stat.mode & 0o777,
        };
      } catch {
        return undefined;
      }
    },

    realpath(path: string): string | undefined {
      try {
        return realpathSync(path);
      } catch {
        return undefined;
      }
    },

    readFile(path: string): Uint8Array {
      return new Uint8Array(readFileSync(path));
    },

    writeFile(path: string, contents: Uint8Array): void {
      writeFileSync(path, contents);
    },

    readlink(path: string): string {
      return readlinkSync(path);
    },

    symlink(target: string, path: string): void {
      symlinkSync(target, path);
    },

    mkdir(path: string, mode?: number): void {
      mkdirSync(path, mode === undefined ? { recursive: true } : { recursive: true, mode });
    },

    remove(path: string): void {
      const stat = lstatSync(path);
      // A symlink to a directory reports as a directory through stat but must
      // be unlinked, not removed recursively -- removing it recursively would
      // delete the contents of whatever it points at.
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        rmSync(path, { recursive: true });
      } else {
        unlinkSync(path);
      }
    },

    chmod(path: string, mode: number): void {
      chmodSync(path, mode);
    },

    copy(from: string, to: string): void {
      const stat = lstatSync(from);
      if (stat.isDirectory()) {
        cpSync(from, to, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
      } else {
        copyFileSync(from, to);
      }
    },
  };
}
