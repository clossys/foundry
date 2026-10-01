/**
 * What the dev-only pack-review page shows, decided without Next.js.
 *
 * `resolvePackReviewPage` is the page's whole decision, kept pure so a test
 * can run it: it checks the target first and returns `not-found` before it
 * calls `loadManifest`, so a target that is not listed reads no record. It
 * takes nothing from a request. A manifest that cannot be loaded, or that the
 * review index refuses, is `unavailable`, with no reason: the loader's error
 * names a path and an index finding names a position, and neither is shown.
 *
 * Server-only in practice (the loader reads a file), but it imports no `next`
 * module and no record.
 */
import { buildPackReviewIndex } from "@clossys/publisher/pack";
import type { PackManifest, PackReviewInput } from "@clossys/publisher/pack";
import type { PackReviewViewExport, PackReviewViewPage } from "@clossys/publisher/web";
import { packReviewAvailable, packReviewHref } from "./site-wiring";
import type { SiteTarget } from "./site-wiring";

export type PackReviewPageModel =
  | { kind: "not-found" }
  | { kind: "unavailable" }
  | { kind: "review"; pages: PackReviewViewPage[]; exports: PackReviewViewExport[] };

export interface PackReviewPageInput extends PackReviewInput {
  target: SiteTarget;
  /** Reads the pack manifest. Called only when the target allows the review. */
  loadManifest: () => unknown;
}

export function resolvePackReviewPage(input: PackReviewPageInput): PackReviewPageModel {
  if (!packReviewAvailable(input.target)) return { kind: "not-found" };

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
    exports: result.index.exports.map((entry) => ({ ...entry })),
  };
}
