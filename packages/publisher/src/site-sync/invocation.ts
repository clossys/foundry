import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** npm's bin link and the module URL can spell the same entry differently. */
export async function isSiteSyncEntry(moduleUrl: string, invocation: string | undefined): Promise<boolean> {
  if (!invocation) return false;
  try { return await realpath(fileURLToPath(moduleUrl)) === await realpath(resolve(invocation)); }
  catch { return false; }
}
