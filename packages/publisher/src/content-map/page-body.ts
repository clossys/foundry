import { checkedContentMap } from "./check.js";
import type { ContentMap, ContentMapProjectedBody } from "./contract.js";
import { isContentMapSpecimenId } from "./page-body-validation.js";

/** Project one cell's body using its already resolved Designer specimen identity.
 * No mapping, registration claim, or fallback specimen is supplied here. */
export function projectPageBody(map: ContentMap, pageId: string, specimenId?: string): ContentMapProjectedBody {
  checkedContentMap(map);
  const page = map.entries.find(entry => entry.id === pageId);
  if (!page || page.kind !== "page") throw new TypeError(`Content-map page is missing: ${pageId}`);
  if (!page.body) throw new TypeError(`Content-map page body is missing: ${pageId}`);
  const authored = page.body.row.specimen;
  const resolved = specimenId ?? authored;
  if (!isContentMapSpecimenId(resolved)) throw new TypeError(`A bound sections.specimen-* identity is required: ${pageId}`);
  if (specimenId !== undefined && authored !== undefined && specimenId !== authored) throw new TypeError(`Specimen binding disagrees with authored page body: ${pageId}`);
  return {
    template: page.body.template,
    bands: { ...page.body.bands },
    row: { specimen: resolved, columns: [...page.body.row.columns] },
  };
}
