/**
 * `clossys release <pub> --build` (flows.md F8 step 2, N13): build the publication from the pins as they resolve now
 * into `.clossys/builds/<id first 8>/`. Producer resolves the pins and calls the build; the content packages never
 * import Producer (system.md 14.2).
 *
 * The build id is the sha256 of the output itself: every file under the build folder as sorted
 * `[relative path, sha256]` rows. So a manifest's `build.id` is checked against the bytes on disk, never trusted.
 * A stamp `.clossys/builds/<id8>.json` records what the build read (publication, locales, the pin map) and
 * `.clossys/builds/latest-<pub>.json` names the publication's latest build. Nothing under `clossys/` is written.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { currentPins, pinDiff, type PinMapOf } from "./pins.js";
import { BUILDS_DIR, PUBLICATION_ID, buildDir, buildsDir, latestBuildFile } from "./paths.js";

export const BUILD_STAMP_SCHEMA = "clossys.release-build/1";

export interface BuildExport { readonly kind: string; readonly path: string }

export interface BuildRequest {
  readonly root: string;
  readonly publication: string;
  /** The release locales (locales.ts), possibly empty when they do not resolve; `release.locales` judges them. */
  readonly locales: readonly string[];
  /** An empty folder the builder writes the whole output into. */
  readonly out: string;
  readonly pins: PinMapOf;
}

export interface BuildOutput {
  readonly routes: number;
  readonly locales: readonly string[];
  readonly exports: readonly BuildExport[];
}

/** Writes the publication's output into `request.out`; throws when it cannot build. */
export type ReleaseBuilder = (request: BuildRequest) => Promise<BuildOutput>;

export interface BuildStamp {
  readonly schema: typeof BUILD_STAMP_SCHEMA;
  readonly publication: string;
  readonly id: string;
  /** `.clossys/builds/<id8>/` */
  readonly path: string;
  readonly routes: number;
  readonly locales: readonly string[];
  readonly exports: readonly BuildExport[];
  /** The pin map the build read (pins.ts currentPins). */
  readonly pins: PinMapOf;
  readonly builtAt: string;
}

/** The sha256 of a build folder: sorted `[relative path, file sha256]` rows. Refuses symbolic links and an empty folder. */
export function buildDigest(dir: string): string {
  const rows: [string, string][] = [];
  const walk = (at: string): void => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`build output ${relative(dir, path)} is a symbolic link`);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) rows.push([relative(dir, path).split(sep).join("/"), createHash("sha256").update(readFileSync(path)).digest("hex")]);
    }
  };
  walk(dir);
  if (rows.length === 0) throw new Error("the build wrote no files");
  rows.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

export const buildPath = (id: string): string => `${BUILDS_DIR.split(sep).join("/")}/${id.slice(0, 8)}/`;
const stampFile = (root: string, id: string): string => join(buildsDir(root), `${id.slice(0, 8)}.json`);

function readJson(file: string): unknown {
  try { return JSON.parse(readFileSync(file, "utf8")) as unknown; } catch { return undefined; }
}

/** The stamp of build `id`, or undefined when there is none or it does not name that id. */
export function readBuildStamp(root: string, id: string): BuildStamp | undefined {
  const stamp = readJson(stampFile(root, id)) as BuildStamp | undefined;
  return stamp?.schema === BUILD_STAMP_SCHEMA && stamp.id === id ? stamp : undefined;
}

/** The publication's latest build stamp, or undefined. */
export function latestBuild(root: string, publication: string): BuildStamp | undefined {
  const pointer = readJson(latestBuildFile(root, publication)) as { publication?: unknown; id?: unknown } | undefined;
  if (pointer?.publication !== publication || typeof pointer.id !== "string") return undefined;
  const stamp = readBuildStamp(root, pointer.id);
  return stamp?.publication === publication ? stamp : undefined;
}

/** Why build `id` does not hold the bytes it names, or undefined when its folder digests to `id`. */
export function buildIssue(root: string, id: string): string | undefined {
  if (!/^[0-9a-f]{64}$/.test(id)) return `build id ${id} is not a sha256`;
  const dir = buildDir(root, id);
  if (!existsSync(dir)) return `build ${buildPath(id)} is not on disk`;
  let digest: string;
  try { digest = buildDigest(dir); } catch (error) { return `build ${buildPath(id)}: ${(error as Error).message}`; }
  return digest === id ? undefined : `build ${buildPath(id)} digests to ${digest.slice(0, 12)}, not ${id.slice(0, 12)}: the output changed after the build`;
}

function checkOutput(output: BuildOutput, out: string): void {
  if (!Number.isInteger(output.routes) || output.routes < 1) throw new Error(`the build reported ${String(output.routes)} routes; a release builds at least one`);
  if (!Array.isArray(output.locales) || output.locales.some(locale => typeof locale !== "string" || !locale)) throw new Error("the build reported invalid locales");
  for (const row of output.exports) {
    if (!row.kind || !row.path || row.path.startsWith("/") || row.path.split("/").includes("..")) throw new Error(`the build reported an invalid export ${JSON.stringify(row)}`);
    if (!existsSync(join(out, row.path))) throw new Error(`the build reported export ${row.path}, which it did not write`);
  }
}

export interface RunBuildOptions {
  readonly builder?: ReleaseBuilder;
  readonly locales: readonly string[];
  readonly now?: () => Date;
}

/**
 * Runs the builder into a fresh staging folder, names the output by its digest, moves it to `.clossys/builds/<id8>/`
 * and writes the stamp and the latest pointer. Refuses when the pins change while the build runs. An identical
 * rebuild keeps the existing folder; a different output under the same 8-character prefix is refused.
 */
export async function runBuild(root: string, publication: string, options: RunBuildOptions): Promise<BuildStamp> {
  if (!PUBLICATION_ID.test(publication)) throw new Error(`${publication} is not a publication id ([a-z0-9-])`);
  const builder = options.builder ?? previewBuilder;
  const pins = currentPins(root);
  mkdirSync(buildsDir(root), { recursive: true });
  const staging = mkdtempSync(join(buildsDir(root), ".staging-"));
  let id: string;
  let output: BuildOutput;
  try {
    output = await builder({ root, publication, locales: [...options.locales], out: staging, pins });
    checkOutput(output, staging);
    id = buildDigest(staging);
    const after = pinDiff(pins, currentPins(root));
    if (after.length) throw new Error(`pins changed while the build ran (${after.map(row => row.ref).join(", ")}): build again`);
    const final = buildDir(root, id);
    if (existsSync(final)) {
      const issue = buildIssue(root, id);
      if (issue) throw new Error(`${buildPath(id)} already holds a different build (${issue})`);
      rmSync(staging, { recursive: true, force: true });
    } else renameSync(staging, final);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  const stamp: BuildStamp = {
    schema: BUILD_STAMP_SCHEMA, publication, id, path: buildPath(id), routes: output.routes,
    locales: [...output.locales], exports: output.exports.map(row => ({ kind: row.kind, path: row.path })), pins,
    builtAt: (options.now ?? (() => new Date()))().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
  writeFileSync(stampFile(root, id), `${JSON.stringify(stamp, null, 2)}\n`);
  writeFileSync(latestBuildFile(root, publication), `${JSON.stringify({ publication, id }, null, 2)}\n`);
  return stamp;
}

/**
 * The default builder: the same code path as `clossys preview` (publisher.md 9.6, one path for release --build and
 * preview). It installs and builds every route from the pins and copies the install output into `site/`.
 * Any install or build finding fails the build.
 */
export const previewBuilder: ReleaseBuilder = async ({ root, publication, locales, out }) => {
  const { preparePreview, buildPreview } = await import("../preview/serve.js");
  const prepared = await preparePreview({ root, publication, locales });
  const result = await buildPreview(prepared);
  if (result.findings.length) throw new Error(`the build failed: ${result.findings.map(row => `${row.page}: ${row.code} ${row.detail ?? ""}`.trim()).join("; ")}`);
  const missing = prepared.routes.filter(route => !result.built.includes(route.page));
  if (missing.length) throw new Error(`the build did not build ${missing.map(route => route.page).join(", ")}`);
  cpSync(prepared.installs, join(out, "site"), { recursive: true, filter: source => !source.split(sep).includes("node_modules") });
  return { routes: prepared.routes.length, locales: [...locales], exports: [{ kind: "react-static", path: "site/" }] };
};
