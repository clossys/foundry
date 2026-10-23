// Example fix: Supply a valid fixture digest so the publication-record producer can run locally.
import {
  appendEntry,
  checkRegistryPublicationReconciliation,
  proposeRegistryPublicationEntry,
} from "@clossys/publisher/record";

const witness = {
  packageName: "@clossys/publisher",
  version: "1.0.0",
  tarballSha256: "a".repeat(64),
  publishedAt: "2026-08-22T12:00:00.000Z",
};

const entry = proposeRegistryPublicationEntry({
  witness,
  strategyRevision: "<opaque publish-path identity, e.g. qualification id>",
});
const ledger = appendEntry([], entry);

const report = checkRegistryPublicationReconciliation(ledger, witness);

export { report };
