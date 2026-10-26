#!/usr/bin/env node
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CatalogError } from "../catalog-core/api.js";
import { compositeLibraryHash } from "../catalog-core/library-components.js";
import type { CompositeCatalogData } from "../catalog-core/types.js";
import { decisionChangeSet, materializeDecisionBundles, type DecisionOptions } from "./apply-decisions.js";
import { LibraryCheckError, LibraryConflictError, readLibrary, writeCompositeLibrary } from "./fs-library.js";

const USAGE = "Usage: node library-apply-decisions.js <folder> --catalog <offline-catalog.json> [--bundles <verified-bundles.json>] [--component-options <observations.json>]";
async function json(path: string): Promise<unknown> {
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile()) throw new CatalogError("decisions: JSON input must be a regular file");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await handle.readFile()));
  } finally { await handle.close(); }
}
export interface DecisionCliIO { out(text: string): void; error(text: string): void }
/** Standalone built Node entrypoint; catalog/bundles/observations are supplied offline, never fetched. */
export async function runApplyDecisions(argv: readonly string[], io: DecisionCliIO = { out: text => console.log(text), error: text => console.error(text) }): Promise<number> {
  try {
    const [folder, ...flags] = argv;
    if (!folder || folder.startsWith("-")) throw new CatalogError(USAGE);
    const options = new Map<string, string>();
    for (let i = 0; i < flags.length; i += 2) {
      const name = flags[i]!, value = flags[i + 1];
      if (!["--catalog", "--bundles", "--component-options"].includes(name) || options.has(name) || !value || value.startsWith("-")) throw new CatalogError(USAGE);
      options.set(name, value);
    }
    if (!options.has("--catalog")) throw new CatalogError(USAGE);
    const catalog = await json(options.get("--catalog")!) as CompositeCatalogData;
    if (!catalog?.values || !catalog.components || !Array.isArray(catalog.values.slots) || !Array.isArray(catalog.values.fills) || !Array.isArray(catalog.components.slots) || !Array.isArray(catalog.components.fills)) throw new CatalogError("decisions: supplied composite catalog required");
    const library = await readLibrary(folder, catalog);
    const decisions = await json(join(folder, "decisions.json"));
    const supplied: DecisionOptions = {};
    if (options.has("--bundles")) {
      const bundles = await json(options.get("--bundles")!);
      if (!Array.isArray(bundles)) throw new CatalogError("decisions: bundles must be an array");
      supplied.bundles = bundles;
    }
    if (options.has("--component-options")) supplied.componentOptions = await json(options.get("--component-options")!) as DecisionOptions["componentOptions"];
    const bundles = await materializeDecisionBundles(catalog, decisions, supplied);
    const change = decisionChangeSet(catalog, library, decisions, bundles);
    const result = await writeCompositeLibrary(folder, catalog, change, supplied.componentOptions);
    io.out(JSON.stringify({ baseHash: change.baseHash, hash: compositeLibraryHash(result), changed: change.baseHash !== compositeLibraryHash(result), decisions: change.changes.length }));
    return 0;
  } catch (error) {
    io.error(error instanceof Error ? error.message : "decisions: apply failed");
    return error instanceof LibraryConflictError || error instanceof LibraryCheckError ? 1 : 2;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runApplyDecisions(process.argv.slice(2));
