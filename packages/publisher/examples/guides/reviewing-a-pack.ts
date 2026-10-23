import { buildPackReviewIndex } from "@clossys/publisher/pack";
import type { PackManifest } from "@clossys/publisher/pack";

const manifest: PackManifest = { schemaVersion: 1, items: [] }; // read from clossys/publisher/pack.json

const result = buildPackReviewIndex(manifest, {
  routes: [{ id: "/" }, { id: "/contact" }],
  states: { "/contact": ["idle", "accepted"] },
});
if (!result.ok) throw new Error(result.issues.map((issue) => issue.rule).join(", "));
console.log(result.index.pages.length, result.index.exports.length);
