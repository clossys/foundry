/**
 * What the dev-only pack-review page and its export route show, decided
 * without Next.js.
 *
 * `packReviewGate` is the one gate for both: it is open only when
 * `SITE_TARGET` is `development` or `test` and the hosting environment
 * (`VERCEL_ENV`) is absent or `development`. It never throws: a `SITE_TARGET`
 * that is absent, unlisted or unknown is closed, so the caller ends in
 * `notFound` and never in a 500 raised here.
 *
 * `resolvePackReviewPage` and `resolvePackReviewExport` check the gate first
 * and return `not-found` before they call any loader, so a closed gate reads
 * no record and no file. Neither takes a path from a request: the export
 * route's `name` is only looked up among the ids the review index lists, and
 * the file read is the path the index lists for that id. A manifest that
 * cannot be loaded, or that the review index refuses, is `unavailable` on the
 * page and `not-found` on the export route, with no reason: the loader's
 * error names a path and an index finding names a position, and neither is
 * shown.
 *
 * Server-only in practice (the loaders read files), but it imports no `next`
 * module and no record.
 */
import { buildPackReviewIndex } from "@clossys/publisher/pack";
import type { PackManifest, PackReviewInput } from "@clossys/publisher/pack";
import type { PackReviewViewExport, PackReviewViewPage } from "@clossys/publisher/web";
import { packReviewAvailable, packReviewHref, resolveSiteTarget } from "./site-wiring";

export type PackReviewPageModel =
  | { kind: "not-found" }
  | { kind: "unavailable" }
  | { kind: "review"; pages: PackReviewViewPage[]; exports: PackReviewViewExport[] };

/** The process environment, or a stand-in: only `SITE_TARGET` and `VERCEL_ENV` are read. */
export type PackReviewEnv = Readonly<Record<string, string | undefined>>;

/** The hosting values that mean a real deployment; `VERCEL_ENV` is also closed for any value that is not `development`. */
const HOSTED_ENVIRONMENTS: readonly string[] = ["production", "preview"];

/**
 * Whether the review may be served at all. Both must hold: `SITE_TARGET` is
 * `development` or `test` (`packReviewAvailable`), and `VERCEL_ENV` is absent
 * or `development`, so a deployment that carries a development `SITE_TARGET`
 * by mistake still refuses on `production` and `preview`. Any other
 * `VERCEL_ENV` value is closed too, and a `SITE_TARGET` that
 * `resolveSiteTarget` refuses is closed, not an error.
 */
export function packReviewGate(env: PackReviewEnv): boolean {
  const hosting = env["VERCEL_ENV"];
  if (hosting !== undefined && (HOSTED_ENVIRONMENTS.includes(hosting) || hosting !== "development")) return false;
  try {
    return packReviewAvailable(resolveSiteTarget(env));
  } catch {
    return false;
  }
}

export interface PackReviewPageInput extends PackReviewInput {
  env: PackReviewEnv;
  /** Reads the pack manifest. Called only when the gate is open. */
  loadManifest: () => unknown;
}

/** The same-site address of an export on the export route. The id comes from the review index. */
export function packReviewExportHref(id: string): string {
  return `/pack/export?name=${encodeURIComponent(id)}`;
}

export function resolvePackReviewPage(input: PackReviewPageInput): PackReviewPageModel {
  if (!packReviewGate(input.env)) return { kind: "not-found" };

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

export type PackReviewExportModel =
  | { kind: "not-found" }
  | { kind: "file"; contentType: string; body: Uint8Array; inline: boolean };

export interface PackReviewExportInput {
  env: PackReviewEnv;
  /** The export's id as the request gave it; anything that is not an id of the index is `not-found`. */
  name: unknown;
  /** Reads the pack manifest. Called only when the gate is open. */
  loadManifest: () => unknown;
  /** Reads one output, by the path the index lists. Called only for a name the index lists. */
  loadOutput: (path: string) => Uint8Array;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  html: "text/html; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

function contentTypeOf(path: string): string | undefined {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot < 0) return undefined;
  const extension = name.slice(dot + 1).toLowerCase();
  return Object.hasOwn(CONTENT_TYPES, extension) ? CONTENT_TYPES[extension] : undefined;
}

/**
 * The bytes of one export, or `not-found`. The gate is checked first; then
 * the index is built from the manifest alone (no route, no state), and the
 * name must be one of its export ids. A manifest, index or file that cannot
 * be read is `not-found` with no reason. A type it does not list is served as
 * a download, never inline.
 */
export function resolvePackReviewExport(input: PackReviewExportInput): PackReviewExportModel {
  const notFound: PackReviewExportModel = { kind: "not-found" };
  if (!packReviewGate(input.env)) return notFound;
  if (typeof input.name !== "string" || input.name.length === 0 || input.name.length > 256) return notFound;

  try {
    const result = buildPackReviewIndex(input.loadManifest() as PackManifest, { routes: [], states: {} });
    if (!result.ok) return notFound;
    const entry = result.index.exports.find((candidate) => candidate.id === input.name);
    if (entry === undefined) return notFound;
    const contentType = contentTypeOf(entry.path);
    return { kind: "file", contentType: contentType ?? "application/octet-stream", body: input.loadOutput(entry.path), inline: contentType !== undefined };
  } catch {
    return notFound;
  }
}

/**
 * The route's `Response`. Both answers are `no-store` and `noindex`; a file
 * is `nosniff` and carries `Content-Security-Policy: sandbox`, so an HTML or
 * SVG export runs no script and has no origin of its own when it is opened.
 * A `not-found` has an empty body.
 */
export function packReviewExportResponse(model: PackReviewExportModel): Response {
  const headers: Record<string, string> = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
  if (model.kind === "not-found") return new Response(null, { status: 404, headers });
  return new Response(model.body as BodyInit, {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": model.contentType,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
      "Content-Disposition": model.inline ? "inline" : "attachment",
    },
  });
}
