/** Authenticate the installed distribution used by native surface compilation and replay. */
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "../catalog-core/digest.js";
import { stableStringify } from "../catalog-core/stable.js";

type InstalledFile = { path: string; sha256: string };
/** One prepare's hashed distributions, keyed by installed package root, so every subpath of a package
 * reuses one walk. Each prepare creates its own; it is never kept across prepares or for the process. */
export type InstalledDistributions = Map<string, Promise<readonly InstalledFile[]>>;

/** Authenticate the modules of one prepare: each installed package root is hashed once for all its subpaths. */
export function installedSurfaceDependencies(modules: readonly string[]) {
  const distributions: InstalledDistributions = new Map();
  return Promise.all(modules.map(module => installedSurfaceDependency(module, distributions)));
}

async function distributionFiles(name: string, directory: string): Promise<readonly InstalledFile[]> {
  let distribution = directory;
  if (name.startsWith("@clossys/")) try { if ((await stat(join(directory, "dist"))).isDirectory()) distribution = join(directory, "dist"); } catch { /* An unbuilt distribution cannot match a source-built certificate. */ }
  const files: InstalledFile[] = [];
  const visit = async (root: string): Promise<void> => {
    for (const file of await readdir(root, { withFileTypes: true })) {
      if (file.name === "node_modules") continue;
      const path = join(root, file.name), local = relative(distribution, path).split("\\").join("/");
      if (file.isDirectory()) await visit(path);
      // The certificate is evidence about executable modules, not one of those modules.
      else if (file.isFile() && path.match(/(?:\.[cm]?js|\.d\.ts|\.json)$/) && local !== "catalog/native-specimen-evidence.json") files.push({ path: local, sha256: sha256(await readFile(path, "utf8")) });
    }
  };
  await visit(distribution); files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

/** `distributions` is the calling prepare's memo; without one, the package is hashed for this call alone. */
export async function installedSurfaceDependency(module: string, distributions: InstalledDistributions = new Map()) {
  const scoped = module.startsWith("@"), name = module.split("/").slice(0, scoped ? 2 : 1).join("/");
  const entry = fileURLToPath(import.meta.resolve(module));
  let directory = dirname(entry), manifest: { name?: string; version?: string; license?: string; exports?: unknown } | undefined;
  for (;;) {
    try { const found = JSON.parse(await readFile(join(directory, "package.json"), "utf8")); if (found.name === name) { manifest = found; break; } } catch { /* Find the owning installed package. */ }
    if (dirname(directory) === directory) throw new Error(`Native surface dependency manifest unavailable: ${module}`);
    directory = dirname(directory);
  }
  if (!manifest?.version || typeof manifest.license !== "string") throw new Error(`Native surface dependency identity unavailable: ${module}`);
  let hashing = distributions.get(directory);
  if (!hashing) distributions.set(directory, hashing = distributionFiles(name, directory));
  const files = [...await hashing];
  const identity = { module, name, version: manifest.version, license: manifest.license, exports: manifest.exports ?? null, entrySha256: sha256(await readFile(entry, "utf8")), files };
  const values = Object.keys(await import(module)).sort();
  return { identity, values, dependency: { module, version: manifest.version, license: manifest.license }, artifactSha256: sha256(stableStringify(identity)) };
}
