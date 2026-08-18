/**
 * `verifyPublishedArtifact` — a thin wrapper, on purpose. This package packs
 * and installs tarballs; it has no opinion of its own about how a digest
 * gets compared to content, because `@vespeneventures/controller/policy` already owns
 * that mechanism and this package is not going to duplicate it.
 */

import { verifyBinding } from "../policy/index.js";
import type { Finding, PolicyBinding } from "../gates/index.js";

/**
 * Constructs a `PolicyBinding` for a published tarball's expected digest —
 * `{ policyId: "published-tarball", digestAlgorithm: "sha256", digest:
 * expectedDigest }` — and calls `@vespeneventures/controller/policy`'s own `verifyBinding`
 * against it. Does no digest comparison of its own; `verifyBinding` already
 * does that, correctly, once.
 *
 * This function does no fetching. `publishedContent` is supplied by the
 * caller however they actually obtained it — a real registry fetch, an
 * `npm pack <name>@<version> --registry ...`, a GitHub Packages API call.
 * Where that content came from is deliberately outside this package's
 * concern, the same way `@vespeneventures/controller/policy` never reads a file itself.
 */
export function verifyPublishedArtifact(expectedDigest: string, publishedContent: string | Uint8Array): Finding[] {
  const binding: PolicyBinding = {
    policyId: "published-tarball",
    digestAlgorithm: "sha256",
    digest: expectedDigest,
  };
  return verifyBinding(binding, publishedContent);
}
