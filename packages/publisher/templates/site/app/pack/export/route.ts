import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { resolvePackReviewExport } from "../../pack-review";
import { loadPackManifest } from "../../site-records";

// The dev-only export route of the pack review: it serves the bytes of one
// output the pack manifest lists, named by `?name=<export id>`. It is behind
// the same gate as the page (`packReviewOpen`, inside the model), it is not in
// `web-route-manifest.json`, and it renders per request.
export const dynamic = "force-dynamic";

/** Reads one listed output, only from inside the repository root that holds `clossys/` (two levels above the app). */
function readOutput(path: string): Uint8Array | undefined {
  const root = resolve(process.cwd(), "..", "..");
  const file = resolve(root, path);
  const inside = relative(root, file);
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) return undefined;
  try {
    return readFileSync(file);
  } catch {
    return undefined;
  }
}

// The only request input is the export name, and the model only compares it
// with the ids the manifest lists. Anything the model does not return as a
// file, whatever the reason, is the same empty 404.
export function GET(request: Request): Response {
  const model = resolvePackReviewExport({
    env: process.env,
    name: new URL(request.url).searchParams.get("name"),
    loadManifest: loadPackManifest,
    readOutput,
  });
  if (model.kind !== "file") return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(model.bytes, { status: 200, headers: model.headers });
}
