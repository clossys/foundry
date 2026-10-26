/** Node-only compiled-byte intake. This operation never loads executable code. */
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, relative, resolve as pathResolve, sep } from "node:path";
import { resolve } from "../catalog-core/api.js";
import { surfaceOf, surfacePath } from "../catalog-core/surface-library.js";
import { surfaceRuntimeIdentity } from "../catalog-core/surface-check.js";
import { runtimeSnapshot } from "../catalog-core/runtime-ports.js";
import { stableStringify } from "../catalog-core/stable.js";
import type { CompositeCatalogData, CompositeEngineInput } from "../catalog-core/types.js";
import type { SurfaceMeasurement, SurfaceSlot } from "../catalog-core/surface-types.js";
import type { RuntimeSourceClosure } from "../catalog-core/runtime-ports.js";

export interface SelectedSurfaceArtifactInput {
  engine: CompositeEngineInput;
  selected: readonly SurfaceSlot[];
  artifacts: readonly { leaf: SurfaceSlot; compiledRoot: string }[];
}
export type SelectedSurfaceArtifactResult =
  | { status: "artifacts"; engine: CompositeEngineInput; surfaces: readonly { leaf: SurfaceSlot; measurement: SurfaceMeasurement; compiledFiles: RuntimeSourceClosure["files"] }[] }
  | { status: "pending"; needs: readonly string[] }
  | { status: "refused"; findings: readonly string[] };

/** Copy finite catalog fields without invoking or replacing registered capabilities. */
function snapshotCatalog(catalog: CompositeCatalogData): CompositeCatalogData {
  const values = runtimeSnapshot(catalog.values), components = runtimeSnapshot(catalog.components);
  if (!catalog.surfaces) return Object.freeze({ values, components });
  const { transforms, rules, ...finite } = catalog.surfaces;
  const surfaces = Object.freeze({ ...runtimeSnapshot(finite),
    transforms: Object.freeze(transforms.map(({ run, ...data }) => Object.freeze({ ...runtimeSnapshot(data), run }))),
    rules: Object.freeze(rules.map(({ run, ...data }) => Object.freeze({ ...runtimeSnapshot(data), run }))),
  });
  return Object.freeze({ values, components, surfaces });
}

/** Every canonical ancestor must remain a regular directory. */
async function directory(path: string): Promise<void> {
  let cursor = path;
  for (;;) {
    if (!(await fs.lstat(cursor)).isDirectory()) throw new Error("COMPILED_PATH_NOT_REGULAR_DIRECTORY");
    const parent = dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

async function readCompiledFiles(rootInput: string, expected: RuntimeSourceClosure["files"]): Promise<RuntimeSourceClosure["files"]> {
  if (typeof rootInput !== "string" || !rootInput.trim()) throw new Error("COMPILED_ROOT_UNAVAILABLE");
  const requestedRoot = pathResolve(rootInput);
  // The explicit root may not be a link. System aliases above that root are
  // canonicalized once; child links are still refused rather than followed.
  if (!(await fs.lstat(requestedRoot)).isDirectory()) throw new Error("COMPILED_PATH_NOT_REGULAR_DIRECTORY");
  const root = await fs.realpath(requestedRoot);
  await directory(root);
  const files: Record<string, string> = {};
  for (const [name, text] of Object.entries(expected)) {
    surfacePath(name);
    const path = pathResolve(root, name), inside = relative(root, path);
    if (!inside || inside === ".." || inside.startsWith(`..${sep}`)) throw new Error("COMPILED_PATH_OUTSIDE_ROOT");
    await directory(dirname(path));
    // The returned bytes are read through this checked regular-file descriptor,
    // never a subsequent unchecked path read. This is no executable load binding.
    const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if (!(await handle.stat()).isFile()) throw new Error("COMPILED_PATH_NOT_REGULAR_FILE");
      const bytes = await handle.readFile();
      if (!bytes.equals(Buffer.from(text, "utf8"))) throw new Error(`COMPILED_BYTES_DIFFER: ${name}`);
      await directory(dirname(path));
      files[name] = bytes.toString("utf8");
    } finally { await handle.close(); }
  }
  return runtimeSnapshot(files);
}

/** Reuse the current owned-source/S8 validators, then read the declared compiled
 * closure independently. An artifact snapshot proves no execution, dependency
 * resolution, React/provider identity, Publisher currency or route readiness. */
export async function readSelectedSurfaceRuntimeArtifacts(input: SelectedSurfaceArtifactInput): Promise<SelectedSurfaceArtifactResult> {
  const findings: string[] = [], needs: string[] = [];
  try {
    const selected = runtimeSnapshot(input.selected), artifacts = runtimeSnapshot(input.artifacts);
    const engine: CompositeEngineInput = Object.freeze({ ...input.engine, catalog: snapshotCatalog(input.engine.catalog), library: runtimeSnapshot(input.engine.library),
      ...(input.engine.componentOptions === undefined ? {} : { componentOptions: runtimeSnapshot(input.engine.componentOptions) }),
      surfaceOptions: runtimeSnapshot(input.engine.surfaceOptions ?? { packages: [], measurements: [] }) });
    if (!selected.length) return { status: "pending", needs: ["SELECTED_SURFACES_UNAVAILABLE"] };
    if (new Set(selected).size !== selected.length || selected.some(leaf => !/^(sections|frames)\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(leaf)))
      return { status: "refused", findings: ["SELECTED_SURFACES_INVALID_OR_DUPLICATE"] };
    if (!engine.library.surfaces?.fills.length) return { status: "pending", needs: ["OWNED_SELECTED_SURFACES_UNAVAILABLE"] };
    if (artifacts.some(artifact => !selected.includes(artifact.leaf)) || new Set(artifacts.map(artifact => artifact.leaf)).size !== artifacts.length)
      return { status: "refused", findings: ["COMPILED_ARTIFACT_FOREIGN_OR_DUPLICATE"] };

    // Resolution validates canonical ownership, original source/component bytes,
    // provenance, registered derivations and the unique current S8 identity.
    const profile = resolve(engine);
    for (const finding of profile.check.findings)
      if (finding.severity === "error" && finding.code !== "S8") findings.push(`${finding.code}: ${finding.subject}: ${finding.message}`);
    const rows: { leaf: SurfaceSlot; measurement: SurfaceMeasurement; compiledRoot: string }[] = [];
    for (const leaf of selected) {
      const owned = engine.library.surfaces.fills.filter(doc => surfaceOf(doc).slot === leaf);
      const row = profile.surfaces?.fills[leaf];
      if (owned.length !== 1 || !row) { findings.push(`SELECTED_SURFACE_NOT_OWNED: ${leaf}`); continue; }
      const measurements = engine.surfaceOptions!.measurements.filter(measurement => measurement.slot === leaf);
      const current = measurements.filter(measurement => stableStringify(measurement.identity) === stableStringify(surfaceRuntimeIdentity(row)));
      if (!measurements.length) { needs.push(`MEASUREMENT_UNAVAILABLE: ${leaf}`); continue; }
      if (current.length !== 1) { findings.push(`MEASUREMENT_STALE_OR_AMBIGUOUS: ${leaf}`); continue; }
      const measurement = current[0]!;
      const errors = profile.surfaces!.check.findings.filter(finding => finding.subject === leaf && finding.severity === "error");
      for (const finding of errors) findings.push(`${finding.code}: ${leaf}: ${finding.message}`);
      if (measurement.scope !== "real") { needs.push(`REAL_MEASUREMENT_UNAVAILABLE: ${leaf}`); continue; }
      const artifact = artifacts.find(artifact => artifact.leaf === leaf);
      if (!artifact) { needs.push(`COMPILED_ARTIFACT_UNAVAILABLE: ${leaf}`); continue; }
      rows.push({ leaf, measurement, compiledRoot: artifact.compiledRoot });
    }
    if (findings.length) return { status: "refused", findings: runtimeSnapshot(findings) };
    if (needs.length) return { status: "pending", needs: runtimeSnapshot(needs) };
    const surfaces: Extract<SelectedSurfaceArtifactResult, { status: "artifacts" }>["surfaces"][number][] = [];
    for (const row of rows) {
      try {
        const compiledFiles = await readCompiledFiles(row.compiledRoot, row.measurement.compiled.files);
        surfaces.push({ leaf: row.leaf, measurement: row.measurement, compiledFiles });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") needs.push(`COMPILED_ARTIFACT_UNAVAILABLE: ${row.leaf}`);
        else findings.push(`${row.leaf}: ${error instanceof Error ? error.message : "COMPILED_ARTIFACT_REFUSED"}`);
      }
    }
    if (findings.length) return { status: "refused", findings: runtimeSnapshot(findings) };
    if (needs.length) return { status: "pending", needs: runtimeSnapshot(needs) };
    return { status: "artifacts", engine, surfaces: runtimeSnapshot(surfaces) };
  } catch (error) {
    return { status: "refused", findings: [error instanceof Error ? error.message : "SELECTED_SURFACE_ARTIFACT_INPUT_INVALID"] };
  }
}
