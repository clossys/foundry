import type { InventoryFileSystemPort } from "./inventory.js";

/**
 * An in-memory `InventoryFileSystemPort` for tests. Not shipped: excluded
 * from the published `files` and from the build, same convention as
 * `@example/provisioning`'s `memory-fs.test-helper.ts`.
 */
export function createMemoryInventoryFileSystem(files: Readonly<Record<string, string>>): InventoryFileSystemPort {
  return {
    readFile(path: string): string | undefined {
      return Object.prototype.hasOwnProperty.call(files, path) ? files[path] : undefined;
    },
  };
}
