import { contentRouteCandidate, contentRouteContent, contentRouteFixture, CONTENT_ROUTE_AT, writerField } from "../../__fixtures__/content-route.js";
import { createContentRevision } from "../../../content/revisions.js";
import type { ContentRouteInput } from "../../content-route-types.js";

export const PREVIEW_SLOT = "sl_hfkj3prso2";
/** A retired example is a lookup alias, never an exception to opaque slot identity. */
export const PREVIEW_LEGACY_ALIAS = "sl_0000000002";

export function previewFixture(): ContentRouteInput {
  const input = contentRouteFixture();
  const active = contentRouteCandidate(contentRouteContent(), "c1", PREVIEW_SLOT);
  const first = contentRouteContent({ name: "Earlier draft", pageMeta: [writerField("title", "Earlier page")],
    composition: { ...contentRouteContent().composition!, sections: [{ ...contentRouteContent().composition!.sections[0]!, fields: [writerField("title", "Earlier body")] }] } });
  const second = contentRouteContent({ name: "Later draft", pageMeta: [writerField("title", "Later page")], pageMetaAssets: { icon: "assets.later-icon" },
    composition: { ...first.composition!, sections: [{ ...first.composition!.sections[0]!, fields: [writerField("title", "Later body")] }] } });
  const r1 = createContentRevision(first, "r1", CONTENT_ROUTE_AT);
  const r2 = createContentRevision(second, "r2", CONTENT_ROUTE_AT);
  const alternate = { ...contentRouteCandidate(second, "c2", PREVIEW_SLOT, "draft"), revision: r2.revision, history: [r1, r2] };
  return { ...input, slotId: PREVIEW_SLOT, registry: {
    ...input.registry,
    slots: input.registry.slots.map(slot => ({ ...slot, id: PREVIEW_SLOT, aliases: [...slot.aliases, PREVIEW_LEGACY_ALIAS], activeCandidateId: "c1" })),
    candidates: [active, alternate],
  } };
}
