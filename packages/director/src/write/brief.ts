/** CLI-only generated artifacts. Pins are made by `clossys pin`; this writes only briefs. */
import { compileBrief, type Brief } from "../brief.js";
import { discoverBriefContracts } from "../brief-contracts.js";
import { directorOutput, readStrategyFile, readStrategyRoot, type DirectorOutput } from "../store.js";
import type { DirectorStore } from "../store-io.js";
import type { Change } from "./transaction.js";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const contractId = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;

/** Generated destinations refuse symlinks, special files and aliases before staging. */
function outputBefore(root: string, store: DirectorStore, path: string): string | undefined {
  const entry = store.reader.stat(root, path);
  if (entry && (entry.type !== "file" || entry.links !== 1)) throw new Error(`Unsafe brief output target: ${path}`);
  return store.reader.read(root, path);
}

/** Rebuild the inventory from stored briefs, so another contract's entry survives a write. */
function inventory(out: DirectorOutput, store: DirectorStore, brief: Brief) {
  const briefs = new Map<string, Brief>();
  const names = store.reader.list(out.base, out.briefs) ?? [];
  for (const name of names) {
    if (!name.endsWith(".json") || name === "index.json" || name === `${brief.contract}.json`) continue;
    const value = JSON.parse(outputBefore(out.base, store, `${out.briefs}/${name}`) ?? "null") as Brief | null;
    if (!value || typeof value.contract !== "string" || !contractId.test(value.contract) || name !== `${value.contract}.json`
      || !["ready", "missing", "stale"].includes(value.state) || typeof value.fingerprint !== "string"
      || !Array.isArray(value.cells) || !Array.isArray(value.missing) || !Array.isArray(value.stale) || typeof value.compiledAt !== "string"
      || value.cells.some(cell => !cell || typeof cell.cell !== "string" || !Number.isSafeInteger(cell.version) || cell.version < 1)) {
      throw new Error(`Invalid written brief: briefs/${name}`);
    }
    briefs.set(value.contract, value);
  }
  briefs.set(brief.contract, brief);
  return { schemaVersion: 1, generatedAt: brief.compiledAt, briefs: [...briefs.values()].sort((a, b) => a.contract.localeCompare(b.contract)).map(value => ({
    contract: value.contract, path: `briefs/${value.contract}.json`, state: value.state,
    missing: value.missing, stale: value.stale, refs: value.cells.map(({ cell, version }) => ({ cell, version })),
    fingerprint: value.fingerprint, compiledAt: value.compiledAt,
  })) };
}

/** Compile and stage the requested outputs under the existing strategy writer lock. */
export function compileAndPersistBrief(root: string, store: DirectorStore, id: string, options: { write?: boolean }): Brief {
  return store.writer.locked(root, () => {
    const model = readStrategyRoot(root, store.reader);
    if (!model.tree || model.issues.length) throw new Error("Cannot compile an invalid strategy root");
    const discovered = discoverBriefContracts(root, store.reader, model.catalog);
    if (discovered.issues.length) throw new Error(`Invalid brief contracts: ${discovered.issues.map(issue => `${issue.path}: ${issue.message}`).join("; ")}`);
    const contract = discovered.contracts.find(candidate => candidate.id === id);
    if (!contract) throw new Error(`Unknown brief contract: ${id}`);
    if (options.write && id === "index") throw new Error("Brief contract id index is reserved for the generated inventory");
    const brief = compileBrief(model, contract, store.reader);
    const changes: Change[] = [], out = directorOutput(root);
    if (options.write) {
      const path = `${out.briefs}/${id}.json`, indexPath = `${out.briefs}/index.json`;
      const before = outputBefore(out.base, store, path);
      const indexBefore = outputBefore(out.base, store, indexPath);
      const index = inventory(out, store, brief);
      changes.push({ path, before, after: json(brief) }, { path: indexPath, before: indexBefore, after: json(index) });
    }
    // Recheck input bytes before the transaction, which also checks every output.
    for (const [path, bytes] of Object.entries(model.files)) {
      if (readStrategyFile(root, store.reader, path) !== bytes) throw new Error(`Strategy source changed during validation: ${path}`);
    }
    if (changes.length) store.writer.commit(out.base, changes);
    return brief;
  });
}
