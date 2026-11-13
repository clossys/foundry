/** Test host copy, retaining old labels so interaction assertions keep their scope. */
import labels from "./writer-copy.json" with { type: "json" };
import meta from "../../../../../writer/src/catalog/records/admin-meta.r1.en.json" with { type: "json" };
import studio from "../../../../../writer/src/catalog/records/admin-studio.r1.en.json" with { type: "json" };
import common from "../../../../../writer/src/catalog/records/common-labels.r1.en.json" with { type: "json" };
import paging from "../../../../../writer/src/catalog/records/admin-writer-paging.r1.en.json" with { type: "json" };
import signIn from "../../../../../writer/src/catalog/records/sign-in.json" with { type: "json" };
import type { PublisherCopyResolver } from "../copy.js";
// Shared labels moved into common-labels keep their canonical ids; its external declarations live with their owners.
const owned = [...paging.records, ...signIn.locales.en.records.filter(record => "text" in record)] as { id: string; text: string }[];
const draftLabels = new Map([...meta.records, ...studio.records, ...common.records, ...owned].map(record => [record.id, record.text]));
/** Explicit draft-review host only; no approval or activation is inferred. */
export const publisherCopyFixtureResolver: PublisherCopyResolver = ref => {
  const text = (labels as Readonly<Record<string, string>>)[ref.id] ?? draftLabels.get(ref.id);
  return text === undefined ? undefined : { ref, text };
};
