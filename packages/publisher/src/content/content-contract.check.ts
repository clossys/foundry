import type { CopyField } from "./composition.js";
import type { ContentPlacement } from "./taxonomy.js";
import type { ContentRevision } from "./model.js";

function contract(revision: ContentRevision, field: CopyField): void {
  // @ts-expect-error Snapshot metadata is immutable.
  revision.digest = "changed";
  // @ts-expect-error Nested snapshot content is immutable.
  revision.content.brief.goal = "changed";
  // @ts-expect-error Snapshot sequences cannot be mutated.
  revision.content.links.push({ toSlotId: "sample", relation: "next", intent: "Continue" });
  // @ts-expect-error Copy fields are immutable.
  field.value = "changed";
}
const copy: CopyField = { key: "heading", locale: "en", value: "Sample", source: "writer" };
// @ts-expect-error Only Writer supplies copy.
const handwritten: CopyField = { ...copy, source: "handwritten" };
// @ts-expect-error Locale is required on each field.
const unlocalized: CopyField = { key: "heading", value: "Sample", source: "writer" };
// @ts-expect-error Visual assets belong to the section, not to words.
const fieldAssets: CopyField = { ...copy, assets: [] };
// @ts-expect-error The retired field/text shape is not the copy contract.
const legacy: CopyField = { field: "heading", text: "Sample", locale: "en", source: "writer" };
// @ts-expect-error The closed taxonomy ties each kind to its group.
const invalidPlacement: ContentPlacement = { l1: "documents", l2: "site" };
void contract;
void invalidPlacement;
void handwritten;
void unlocalized;
void fieldAssets;
void legacy;
