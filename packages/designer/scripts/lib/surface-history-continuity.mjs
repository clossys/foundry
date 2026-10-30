import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const metadata = document => document.$extensions["com.clossys.fill"];
const identity = (document, api) => {
  const meta = metadata(document);
  return { source: meta.source, fill: meta.id, license: meta.license, pin: meta.pin, descriptorHash: api.surfacePackageDescriptorHash(api.surfaceEntryOf(document)) };
};
const packages = (catalog, api) => catalog.fills.filter(document => api.isSurfacePackageEntry(api.surfaceEntryOf(document)));

/** Retain the exact prior public document and its same-revision contract. */
export function checkSurfaceDescriptorTransitions({ catalog, priors, api, stableStringify }) {
  const findings = [], rows = [], current = packages(catalog, api);
  for (const prior of priors) for (const document of packages(prior.catalog, api)) {
    const meta = metadata(document), previous = identity(document, api);
    const candidates = current.filter(row => metadata(row).slot === meta.slot);
    const contract = prior.catalog.slots.find(row => row.id === meta.slot);
    const currentContract = catalog.slots.find(row => row.id === meta.slot);
    if (contract && currentContract && candidates.length === 1 && stableStringify(candidates[0]) === stableStringify(document) && stableStringify(currentContract) === stableStringify(contract)) continue;
    const row = { leaf: meta.slot, baseline: prior.source, descriptorHash: previous.descriptorHash };
    try {
      // A current candidate with the same hash must not satisfy a history obligation.
      const registered = api.resolveSurfacePackageDescriptor({ surfaces: { ...catalog, fills: [] } }, meta.slot, previous);
      if (!contract || stableStringify(registered.document) !== stableStringify(document) || stableStringify(registered.contract) !== stableStringify(contract)) throw new Error("Previous public document or same-revision contract differs");
      rows.push({ ...row, status: "PASS" });
    } catch (error) {
      findings.push({ code: "surface-history-continuity", ...row, detail: error.message });
      rows.push({ ...row, status: "FAIL" });
    }
  }
  return { findings, rows };
}

const snapshotPaths = ["package.json", "packages/designer/package.json", "packages/designer/src", "packages/designer/scripts", "packages/designer/styles", "packages/publisher/package.json", "packages/publisher/src"];
const snapshotDirectory = () => fs.mkdtempSync(path.join(os.tmpdir(), "surface-history-source-"));
function readCatalog(snapshot) {
  const directory = path.join(snapshot, "packages/designer/src/catalog");
  return {
    slots: ["sections", "frames"].flatMap(layer => JSON.parse(fs.readFileSync(path.join(directory, `slots/${layer}.json`), "utf8"))),
    fills: fs.readdirSync(path.join(directory, "fills/foundry")).filter(name => name.match(/^(sections|frames)\.(?!coverage\.)[^/]+\.json$/)).map(name => JSON.parse(fs.readFileSync(path.join(directory, "fills/foundry", name), "utf8"))),
  };
}
function nativeCatalog(snapshot, root) {
  fs.symlinkSync(path.join(root, "node_modules"), path.join(snapshot, "node_modules"), "dir");
  // Measurements and descriptors share a JSON module cache within one process.
  // A fresh second process observes newly generated measurements; a third proves
  // the result is stable rather than silently accepting an intermediate output.
  for (const mode of ["--write", "--write", "--check"]) execFileSync(process.execPath, ["packages/designer/scripts/generate-surface-consumption.mjs", mode], { cwd: snapshot, stdio: ["ignore", "pipe", "pipe"] });
  return readCatalog(snapshot);
}

/** Compare live source against HEAD and every immediate parent, independently for
 * recorded descriptors and native source generation. The second comparison catches
 * builds emitted before generated JSON was committed. Every merge parent counts.
 * Git cannot identify source that was never committed; no external artifact is inferred.
 * Public source snapshots remain outside the repository and never use stale dist.
 */
export async function checkSurfaceHistoryContinuity(repository, sourceModule) {
  const root = path.resolve(repository);
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const api = await sourceModule(path.join(root, "packages/designer/src/catalog-core/surface-library.ts"));
  const { stableStringify } = await sourceModule(path.join(root, "packages/designer/src/catalog-core/stable.ts"));
  const live = (await sourceModule(path.join(root, "packages/designer/src/library-cli/surface-catalog.ts"))).foundrySurfaceCatalog();
  const currentSnapshot = snapshotDirectory();
  for (const file of snapshotPaths) {
    const target = path.join(currentSnapshot, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(path.join(root, file), target, { recursive: true });
  }
  const currentNative = { ...nativeCatalog(currentSnapshot, root), packageHistory: live.packageHistory };
  const recordedPriors = [], nativePriors = [], baselines = [];
  const commits = [...new Set(git("rev-list", "--parents", "-n", "1", "HEAD").split(/\s+/))];
  for (const commit of commits) {
    if (!commit.match(/^[a-f0-9]{40}$/)) throw new Error("Unresolved continuity baseline");
    const snapshot = snapshotDirectory();
    const archive = execFileSync("git", ["archive", commit, ...snapshotPaths], { cwd: root, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    execFileSync("tar", ["-x", "-C", snapshot], { input: archive, stdio: ["pipe", "pipe", "pipe"] });
    recordedPriors.push({ source: `${commit}:recorded`, catalog: readCatalog(snapshot) });
    nativePriors.push({ source: `${commit}:native-source`, catalog: nativeCatalog(snapshot, root) });
    baselines.push({ commit, tree: git("rev-parse", `${commit}^{tree}`), observations: ["recorded", "native-source"], snapshot });
  }
  const recorded = checkSurfaceDescriptorTransitions({ catalog: live, priors: recordedPriors, api, stableStringify });
  const native = checkSurfaceDescriptorTransitions({ catalog: currentNative, priors: nativePriors, api, stableStringify });
  return { findings: [...recorded.findings, ...native.findings], rows: [...recorded.rows, ...native.rows], baselines, currentSnapshot };
}
