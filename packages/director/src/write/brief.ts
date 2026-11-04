/** CLI-only generated artifacts. Cell, confirmation and activation writes stay separate. */
import { lstatSync, readdirSync } from "node:fs";
import { compileBrief, type Brief } from "../brief.js";
import { discoverBriefContracts } from "../brief-contracts.js";
import { readStrategyRoot } from "../store.js";
import { commitChanges, readBytes, safePath, withWriteLock, type Change } from "./transaction.js";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const contractId = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;

/** Generated destinations refuse symlinks, special files and aliases before staging. */
function outputBefore(root: string, path: string): string | undefined {
  const full = safePath(root, path);
  try {
    const stat = lstatSync(full);
    if (!stat.isFile() || stat.nlink !== 1) throw new Error(`Unsafe brief output target: ${path}`);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return readBytes(root, path);
}

/** Rebuild the inventory from stored briefs, so another contract's entry survives a write. */
function inventory(root: string, brief: Brief) {
  const briefs = new Map<string, Brief>();
  const directory = safePath(root, "briefs");
  let names: string[] = [];
  try {
    if (!lstatSync(directory).isDirectory()) throw new Error("Briefs must be a directory");
    names = readdirSync(directory).sort();
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  for (const name of names) {
    if (!name.endsWith(".json") || name === "index.json" || name === `${brief.contract}.json`) continue;
    const value = JSON.parse(outputBefore(root, `briefs/${name}`) ?? "null") as Brief | null;
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
export function compileAndPersistBrief(root: string, id: string, options: { write?: boolean; request?: boolean }): Brief {
  return withWriteLock(root, () => {
    const model = readStrategyRoot(root);
    if (!model.tree || model.issues.length) throw new Error("Cannot compile an invalid strategy root");
    const discovered = discoverBriefContracts(root, model.catalog);
    if (discovered.issues.length) throw new Error(`Invalid brief contracts: ${discovered.issues.map(issue => `${issue.path}: ${issue.message}`).join("; ")}`);
    const contract = discovered.contracts.find(candidate => candidate.id === id);
    if (!contract) throw new Error(`Unknown brief contract: ${id}`);
    if (options.write && id === "index") throw new Error("Brief contract id index is reserved for the generated inventory");
    const brief = compileBrief(model, contract);
    const changes: Change[] = [];
    if (options.write) {
      const path = `briefs/${id}.json`;
      const before = outputBefore(root, path);
      const indexBefore = outputBefore(root, "briefs/index.json");
      const index = inventory(root, brief);
      changes.push({ path, before, after: json(brief) }, { path: "briefs/index.json", before: indexBefore, after: json(index) });
    }
    if (options.request && brief.state === "missing") {
      const detail = `${id} brief requested; no active version for: ${brief.missing.join(", ")}.`;
      const existing = model.requests.some(request => request.kind === "missing" && request.raisedBy === contract.owner
        && ["open", "drafted"].includes(request.status) && request.detail === detail
        && request.cells.length === brief.missing.length && request.cells.every(cell => brief.missing.includes(cell)));
      if (!existing) {
        const next = Math.max(0, ...model.requests.map(request => Number(request.id.slice(4)))) + 1;
        if (next > 9999) throw new Error("Request id limit reached");
        const requestId = `REQ-${String(next).padStart(4, "0")}`;
        const path = `requests/${requestId}.json`;
        if (outputBefore(root, path) !== undefined) throw new Error("Request destination already exists");
        changes.push({ path, after: json({ id: requestId, raisedBy: contract.owner, kind: "missing", cells: brief.missing,
          detail, status: "open", opened: new Date().toISOString().slice(0, 10), resolvedBy: null }) });
      }
    }
    // Recheck input bytes before the transaction, which also checks every output.
    for (const [path, bytes] of Object.entries(model.files)) {
      if (readBytes(root, path) !== bytes) throw new Error(`Strategy source changed during validation: ${path}`);
    }
    if (changes.length) commitChanges(root, changes);
    return brief;
  });
}
