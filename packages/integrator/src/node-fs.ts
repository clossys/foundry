import { readFileSync } from "node:fs";
import type { InventoryFileSystemPort } from "./inventory.js";

/**
 * The default adapter: `InventoryFileSystemPort` backed by the real
 * filesystem. A separate module and a separate export, same as
 * `@example/provisioning`'s `createNodeFileSystem`, so that importing
 * this package never implies touching a disk -- a caller wanting a sandboxed
 * root or an audit log wraps or replaces this, and nothing downstream can tell.
 */
export function createNodeInventoryFileSystem(): InventoryFileSystemPort {
  return {
    readFile(path: string): string | undefined {
      try {
        return readFileSync(path, "utf8");
      } catch (error) {
        if (isEnoent(error)) return undefined;
        throw error;
      }
    },
  };
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}
