/** Test host copy, retaining old labels so interaction assertions keep their scope. */
import labels from "./writer-copy.json" with { type: "json" };
import type { PublisherCopyResolver } from "../copy.js";
export const publisherCopyFixtureResolver: PublisherCopyResolver = ref => {
  const text = (labels as Readonly<Record<string, string>>)[ref.id];
  return text === undefined ? undefined : { ref, text };
};
