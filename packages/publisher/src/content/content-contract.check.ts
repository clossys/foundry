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
  // @ts-expect-error Only handwritten copy exists in v1.
  field.source = "writer";
}
// @ts-expect-error The closed taxonomy ties each kind to its group.
const invalidPlacement: ContentPlacement = { l1: "documents", l2: "site" };
void contract;
void invalidPlacement;
