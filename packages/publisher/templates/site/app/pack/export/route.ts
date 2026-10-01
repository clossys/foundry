import { resolve } from "node:path";
import { packReviewExportResponse, resolvePackReviewExport } from "../../pack-review";
import { readPackReviewFile } from "../../pack-review-files";
import { loadPackManifest } from "../../site-records";

// The dev-only export route: the OG image, the notification email and its
// plain-text variant, by the ids the pack review lists. Same gate as the page
// (`packReviewGate`, decided inside `resolvePackReviewExport` before any record
// or file is read). It is not in `web-route-manifest.json`, and it renders per
// request so the environment is read on every request and never baked in.
export const dynamic = "force-dynamic";

// An output path is relative to the repository root, two levels above the app.
// The index has already refused an absolute path and a `..` segment;
// `readPackReviewFile` also keeps the resolved path inside the root once links
// are followed.
function loadOutput(path: string): Uint8Array {
  return readPackReviewFile(resolve(process.cwd(), "..", ".."), path);
}

// The one request input is `name`: it is looked up among the review index's
// ids and is never used as a path.
export function GET(request: Request): Response {
  return packReviewExportResponse(
    resolvePackReviewExport({
      env: process.env,
      name: new URL(request.url).searchParams.get("name"),
      loadManifest: loadPackManifest,
      loadOutput,
    }),
  );
}
