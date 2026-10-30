import type { CopyField } from "./composition.js";
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
const handwritten: CopyField = { ...copy, source: "handwritten" };
// @ts-expect-error Unknown copy providers are not readable legacy copy.
const unknownProvider: CopyField = { ...copy, source: "unknown" };
const reference: CopyField = { key: "heading", locale: "en", source: "writer", ref: { id: "strings.heading" } };
// @ts-expect-error Writer refs cannot carry an inline text cache.
const mixed: CopyField = { ...reference, value: "Cached" };
// @ts-expect-error Locale is required on each field.
const unlocalized: CopyField = { key: "heading", value: "Sample", source: "writer" };
// @ts-expect-error Visual assets belong to the section, not to words.
const fieldAssets: CopyField = { ...copy, assets: [] };
// @ts-expect-error The retired field/text shape is not the copy contract.
const legacy: CopyField = { field: "heading", text: "Sample", locale: "en", source: "writer" };
void contract;
void handwritten;
void unknownProvider;
void mixed;
void unlocalized;
void fieldAssets;
void legacy;
