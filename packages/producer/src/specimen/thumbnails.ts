/**
 * Snapshot thumbnails: one specimen rendered headless to a PNG per width, keyed by the
 * content it shows. A key already in the cache is not rendered again.
 *
 * The key hashes the specimen build (payload plus every sibling record it imports and the
 * renderer version), the record's own bytes and the theme, so any change to what the
 * specimen shows names a new file. Rendering is Publisher's; this module only orders it.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  captureSpecimen, createSpecimenBuilder, directoryRecordSource, parseThemeParam, specimenUrl, startSpecimenServer, SPECIMEN_RENDERER_VERSION,
  type SpecimenEsbuild,
} from "@clossys/publisher/specimen";
import { parseSpecimenHealthMessage, type SpecimenHealthMessage } from "./health-contract.js";

export const DEFAULT_THUMBNAIL_CACHE = join("node_modules", ".cache", "clossys", "specimen-thumbs");
export const DEFAULT_THUMBNAIL_WIDTHS = [480] as const;

export interface SnapshotOptions {
  /** Record roots (`<root>/<id>/v<n>/`). */
  readonly records: readonly string[];
  readonly element: string;
  readonly version?: number;
  /** `light`, `dark`, `<id>` or `<id>:<mode>`. */
  readonly theme?: string;
  readonly defaultTheme?: string;
  readonly widths?: readonly number[];
  readonly height?: number;
  /** Cache directory; defaults to `node_modules/.cache/clossys/specimen-thumbs` under `cwd`. */
  readonly cache?: string;
  /** Where npm imports in payloads resolve from. Defaults to `cwd`. */
  readonly workspace?: string;
  readonly cwd?: string;
  readonly executable?: string;
  readonly esbuild?: SpecimenEsbuild;
}

export interface SnapshotThumbnail {
  readonly width: number;
  readonly key: string;
  readonly path: string;
  readonly healthPath: string;
  /** True when the PNG was already in the cache and nothing was rendered. */
  readonly cached: boolean;
  readonly health?: SpecimenHealthMessage;
  readonly consoleErrors?: readonly string[];
}

export interface SnapshotResult {
  readonly element: string;
  readonly version: number;
  readonly theme: string;
  readonly cache: string;
  readonly thumbnails: readonly SnapshotThumbnail[];
}

const exists = async (path: string) => stat(path).then(() => true, () => false);
const sha256 = (...parts: string[]) => parts.reduce((hash, part) => hash.update(part).update("\0"), createHash("sha256")).digest("hex");

/** The cache key for one specimen at one theme (width is part of the file name). */
export function thumbnailKey(input: { buildHash: string; recordHash: string; themeHash: string; mode: string }): string {
  return sha256(SPECIMEN_RENDERER_VERSION, input.buildHash, input.recordHash, input.themeHash, input.mode).slice(0, 32);
}

async function writeAtomic(path: string, data: string | Buffer) {
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, data);
  await rename(temp, path);
}

export async function snapshotSpecimen(options: SnapshotOptions): Promise<SnapshotResult> {
  const cwd = options.cwd ?? process.cwd();
  const cache = resolve(cwd, options.cache ?? DEFAULT_THUMBNAIL_CACHE);
  const widths = [...new Set(options.widths?.length ? options.widths : DEFAULT_THUMBNAIL_WIDTHS)];
  const request = parseThemeParam(options.theme);
  if (!request) throw new Error(`theme must be light, dark, <id> or <id>:<light|dark>`);
  const source = directoryRecordSource({ roots: options.records.map(root => resolve(cwd, root)), ...(options.defaultTheme ? { defaultTheme: options.defaultTheme } : {}) });
  const record = await source.read(options.element, options.version);
  if (!record) throw new Error(`element ${options.element}${options.version ? `@v${options.version}` : ""} not found`);
  const theme = await source.theme(request.id ?? record.preview.theme);
  const builder = createSpecimenBuilder({ workspace: resolve(cwd, options.workspace ?? "."), ...(options.esbuild ? { esbuild: options.esbuild } : {}) });
  const build = await builder.build(record, source);
  const key = thumbnailKey({ buildHash: build.hash, recordHash: record.contentHash, themeHash: theme?.contentHash ?? "none", mode: request.mode });
  await mkdir(cache, { recursive: true });

  const thumbnails: SnapshotThumbnail[] = [];
  let server: Awaited<ReturnType<typeof startSpecimenServer>> | undefined;
  try {
    for (const width of widths) {
      const path = join(cache, `${key}-${width}.png`), healthPath = join(cache, `${key}-${width}.health.json`);
      if (await exists(path)) {
        const saved = await readFile(healthPath, "utf8").then(text => parseSpecimenHealthMessage(JSON.parse(text).health), () => undefined);
        thumbnails.push({ width, key, path, healthPath, cached: true, ...(saved?.ok ? { health: saved.message } : {}) });
        continue;
      }
      server ??= await startSpecimenServer({ source, builder });
      const url = specimenUrl(server.url, { element: record.id, version: record.version, ...(options.theme ? { theme: options.theme } : {}), width });
      const capture = await captureSpecimen(url, { width, height: options.height ?? Math.round(width * 0.75), screenshot: true, settleMs: 200, ...(options.executable ? { executable: options.executable } : {}) });
      if (!capture.screenshot) throw new Error(`${record.id}: no screenshot captured at ${width}px`);
      const parsed = parseSpecimenHealthMessage(capture.health);
      await writeAtomic(healthPath, `${JSON.stringify({ element: record.id, version: record.version, width, key, consoleErrors: capture.consoleErrors, health: capture.health ?? null }, null, 2)}\n`);
      await writeAtomic(path, capture.screenshot);
      thumbnails.push({ width, key, path, healthPath, cached: false, consoleErrors: capture.consoleErrors, ...(parsed.ok ? { health: parsed.message } : {}) });
    }
  } finally {
    if (server) { server.server.closeAllConnections(); await new Promise(done => server!.server.close(done)); }
  }
  return { element: record.id, version: record.version, theme: `${theme?.id ?? "none"}:${request.mode}`, cache, thumbnails };
}
