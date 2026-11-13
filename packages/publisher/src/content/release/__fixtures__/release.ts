import { createContentOwnerApproval } from "../../approval.js";
import { computeContentDigest } from "../../digest.js";
import { createContentRevision } from "../../revisions.js";
import { reviewCandidate } from "../../review/index.js";
import { field, reviewInput } from "../../review/__fixtures__/review.js";
import type { ReleaseInput } from "../types.js";

type Mutable<T> = T extends readonly (infer V)[] ? Mutable<V>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
export type Fixture = Mutable<ReleaseInput>;
export const at = "2026-02-04T05:06:07Z";

function refreshCandidates(input: Pick<Fixture, "registry" | "at" | "approvedBy">): void {
  for (const candidate of input.registry.candidates) {
    const snapshot = createContentRevision(candidate, "r1", input.at);
    candidate.revision = "r1";
    candidate.history = [structuredClone(snapshot) as Mutable<typeof snapshot>];
    candidate.approval = createContentOwnerApproval(candidate, {
      by: input.approvedBy, at: input.at, revision: candidate.revision, digest: computeContentDigest(candidate),
    });
  }
}

function currentReview(input: Pick<Fixture, "registry" | "at">, candidateId: string): Fixture["selections"][number]["review"] {
  const candidate = input.registry.candidates.find(candidate => candidate.id === candidateId);
  if (!candidate) throw new TypeError(`Missing release fixture candidate: ${candidateId}`);
  return structuredClone(reviewCandidate({
    registry: input.registry, candidateId, libraries: reviewInput().libraries,
    digest: computeContentDigest(candidate), raisedAt: input.at,
  })) as Fixture["selections"][number]["review"];
}

/** A real owner-approved active admin candidate, reviewed for both selected locales. */
export function releaseInput(): Fixture {
  const registry = reviewInput().registry;
  registry.workspace.deployTargets = [{ id: "product-admin", repo: "sample", app: "admin" }];
  const slot = registry.slots[0]!;
  slot.l2 = "admin";
  slot.aliases = ["websites/admin/agents-sample"];
  slot.position = { order: 0, name: "agents-sample" };
  slot.name = "Sample agent";
  slot.deployTarget = "product-admin";
  slot.route = "/agents/sample";
  const candidate = registry.candidates[0]!;
  candidate.composition!.frame.frameId = "frames.app-shell";
  candidate.pageMeta = [
    field("title", "en", "Sample agent"), field("title", "fr", "Agent exemple"),
    field("description", "en", "Manage the sample agent"), field("description", "fr", "Gérer l’agent exemple"),
  ];
  const input = { registry, at, approvedBy: "owner" };
  refreshCandidates(input);
  return { ...input, selections: [{ candidateId: candidate.id, review: currentReview(input, candidate.id) }] };
}

/** Rebuild r1 snapshots, owner evidence, and real Review after a fixture content edit. */
export function refreshReleaseInput(input: Fixture): Fixture {
  refreshCandidates(input);
  input.selections = input.selections.map(({ candidateId }) => ({ candidateId, review: currentReview(input, candidateId) }));
  return input;
}
