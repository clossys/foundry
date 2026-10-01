/**
 * What the dev-only pack-review page and its export route show, decided
 * without Next.js.
 *
 * `packReviewOpen` is the one gate, and both decisions below ask it first:
 * `resolvePackReviewPage` and `resolvePackReviewExport` return `not-found`
 * before they call `loadManifest` or `readOutput`, so a request the gate
 * refuses reads no record and no file. They take the environment as a value,
 * never from the request. A manifest that cannot be loaded, or that the
 * review index refuses, is `unavailable` on the page and `not-found` on the
 * export route, with no reason: the loader's error names a path and an index
 * finding names a position, and neither is shown.
 *
 * Server-only in practice (the loaders read files), but it imports no `next`
 * module and no record, and it reads no environment itself.
 */
import { buildPackReviewIndex } from "@clossys/publisher/pack";
import type { PackManifest, PackReviewInput } from "@clossys/publisher/pack";
import type { PackReviewViewExport, PackReviewViewPage } from "@clossys/publisher/web";
import { packReviewAvailable, packReviewHref, resolveSiteTarget } from "./site-wiring";

/** The process environment, or any record shaped like it. */
export type PackReviewEnv = Readonly<Record<string, string | undefined>>;

/** The hosting environments the route may be served from: none named, or Vercel's own `vercel dev`. */
const OPEN_HOSTING: readonly (string | undefined)[] = [undefined, "development"];

/**
 * Whether the review may be served at all. Two checks, both required:
 *
 * - `SITE_TARGET` resolves to a target `packReviewAvailable` lists
 *   (`development` or `test`). An absent value is `production`; a value that
 *   is set but unknown is refused here and does not throw, so the route
 *   answers 404 and never 500.
 * - `VERCEL_ENV`, the hosting environment, is absent or `development`. It is
 *   `production` on a production deployment and `preview` on a preview one,
 *   and a deployment that carries a development `SITE_TARGET` is still public,
 *   so either of those refuses; so does any value not listed.
 */
export function packReviewOpen(env: PackReviewEnv): boolean {
  let target: ReturnType<typeof resolveSiteTarget>;
  try {
    target = resolveSiteTarget(env);
  } catch {
    return false;
  }
  return packReviewAvailable(target) && OPEN_HOSTING.includes(env["VERCEL_ENV"]);
}

export type PackReviewPageModel =
  | { kind: "not-found" }
  | { kind: "unavailable" }
  | { kind: "review"; pages: PackReviewViewPage[]; exports: PackReviewViewExport[] };

export interface PackReviewPageInput extends PackReviewInput {
  env: PackReviewEnv;
  /** Reads the pack manifest. Called only when the gate is open. */
  loadManifest: () => unknown;
}

/** The same-site address of one export, pinned by its index id (never by its path). */
export function packReviewExportHref(id: string): string {
  return `/pack/export?name=${encodeURIComponent(id)}`;
}

export function resolvePackReviewPage(input: PackReviewPageInput): PackReviewPageModel {
  if (!packReviewOpen(input.env)) return { kind: "not-found" };

  let result: ReturnType<typeof buildPackReviewIndex>;
  try {
    result = buildPackReviewIndex(input.loadManifest() as PackManifest, { routes: input.routes, states: input.states });
  } catch {
    return { kind: "unavailable" };
  }
  if (!result.ok) return { kind: "unavailable" };

  return {
    kind: "review",
    pages: result.index.pages.map((page) => ({
      id: page.id,
      href: packReviewHref(page.id),
      status: page.status,
      states: page.states.map((state) => ({ id: state, href: packReviewHref(page.id, state) })),
    })),
    exports: result.index.exports.map((entry) => ({ ...entry, href: packReviewExportHref(entry.id) })),
  };
}

// ------------------------------------------------------------------ exports

/** What a file type is served as. A type not listed is a download, never rendered. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  html: "text/html; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

/**
 * Every served file is sealed: it is not sniffed, not cached, and runs in a
 * sandbox with no script and no sub-resource but inline styles and `data:`
 * images, so an HTML email or an SVG cannot reach the site's own origin.
 */
const SEALED_HEADERS: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
  "content-security-policy": "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
};

function extensionOf(path: string): string {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export type PackReviewExportModel =
  | { kind: "not-found" }
  | { kind: "file"; bytes: Uint8Array; headers: Readonly<Record<string, string>> };

export interface PackReviewExportInput {
  env: PackReviewEnv;
  /** The export's index id, from the query string; compared with the listed ids and used for nothing else. */
  name: string | null;
  /** Reads the pack manifest. Called only when the gate is open. */
  loadManifest: () => unknown;
  /** Reads the bytes of an output path the manifest lists, or `undefined` when it cannot. Called only for a listed export. */
  readOutput: (path: string) => Uint8Array | undefined;
}

/**
 * The export route's whole decision. `not-found` when the gate is closed, the
 * name is not exactly one of the listed export ids, the manifest cannot be
 * listed, or the listed output cannot be read; the name selects an entry and
 * never forms a path, so the file read is always a path `pack.json` lists and
 * the index has already checked.
 */
export function resolvePackReviewExport(input: PackReviewExportInput): PackReviewExportModel {
  if (!packReviewOpen(input.env)) return { kind: "not-found" };
  if (typeof input.name !== "string" || input.name.length === 0) return { kind: "not-found" };

  let path: string;
  try {
    const result = buildPackReviewIndex(input.loadManifest() as PackManifest, { routes: [], states: {} });
    if (!result.ok) return { kind: "not-found" };
    const entry = result.index.exports.find((candidate) => candidate.id === input.name);
    if (entry === undefined) return { kind: "not-found" };
    path = entry.path;
  } catch {
    return { kind: "not-found" };
  }

  let bytes: Uint8Array | undefined;
  try {
    bytes = input.readOutput(path);
  } catch {
    return { kind: "not-found" };
  }
  if (bytes === undefined) return { kind: "not-found" };

  const contentType = CONTENT_TYPES[extensionOf(path)];
  return {
    kind: "file",
    bytes,
    headers: {
      "content-type": contentType ?? "application/octet-stream",
      ...(contentType === undefined ? { "content-disposition": "attachment" } : {}),
      ...SEALED_HEADERS,
    },
  };
}
