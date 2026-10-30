import { expect, it } from "vitest";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { isSiteSyncEntry } from "./invocation.js";

it("recognizes an installed bin symlink and refuses unrelated or missing invocations", async () => {
  const root = await mkdtemp(join(tmpdir(), "site-sync-entry-"));
  try {
    const file = join(root, "entry.mjs"), link = join(root, "command"), other = join(root, "other.mjs");
    await writeFile(file, "export {};\n"); await writeFile(other, "export {};\n"); await symlink(file, link);
    expect(await isSiteSyncEntry(pathToFileURL(file).href, link)).toBe(true);
    expect(await isSiteSyncEntry(pathToFileURL(link).href, file)).toBe(true);
    expect(await isSiteSyncEntry(pathToFileURL(file).href, other)).toBe(false);
    expect(await isSiteSyncEntry(pathToFileURL(file).href, undefined)).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
