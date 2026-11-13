import { mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

/**
 * One harness test's own temporary tree, under the OS temp directory (TMPDIR), never inside the
 * checkout. Fixtures materialized below it still resolve the repository's installed packages through
 * one `node_modules` link to the repository's own `node_modules`, so bundling and type-checking see
 * the same installed artifacts the lock binds. The caller removes the tree in its afterAll.
 */
export function harnessTemp(prefix: string, repository: string): string {
  const temp = mkdtempSync(resolve(realpathSync(tmpdir()), prefix));
  symlinkSync(resolve(repository, "node_modules"), resolve(temp, "node_modules"), "dir");
  return temp;
}
