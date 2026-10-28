import { computeContentDigest } from "../../digest.js";
import { createContentRevision } from "../../revisions.js";
import { reviewFixture } from "../../__fixtures__/review.js";
import type { ReviewInput, ReviewLibrarySnapshot } from "../types.js";

type Mutable<T> = T extends readonly (infer V)[] ? Mutable<V>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
export const raisedAt = "2026-02-03T04:05:06Z";
export const peerSlotId = "sl_2xv4y3uo7k" as const;
export type Fixture = Mutable<ReviewInput>;

/** Every baseline has real revision content and explicit Designer metadata. */
export function reviewInput(): Fixture {
  const registry = structuredClone(reviewFixture()) as Mutable<ReviewInput["registry"]>;
  registry.workspace.locales = ["en", "fr"];
  registry.workspace.deployTargets = [{ id: "public", repo: "sample", app: "site" }, { id: "other", repo: "sample", app: "other" }];
  const slot = registry.slots[0]!;
  slot.locales = ["en", "fr"]; slot.route = "/home"; slot.deployTarget = "public";
  const candidate = registry.candidates[0]!;
  candidate.composition!.frame.frameId = "frames.site-shell";
  candidate.composition!.sections[0]!.fields = [field("title", "en", "Sample"), field("title", "fr", "Exemple")];
  const libraries: ReviewLibrarySnapshot[] = [{
    consumerId: "sample", version: "1",
    frames: [{ id: "frames.site-shell", configIds: ["default"] }, { id: "frames.app-shell", configIds: ["default"] }],
    sections: [{ id: "sections.sample", configIds: ["default", "logo-only"], passageSchema: "passages.sample", copy: { sourceLocale: "en", fields: [{ key: "title", kind: "plain", required: true, maxLength: { en: 12, fr: 12 }, dir: "auto" }] }, assetKinds: ["image"] }],
    assetIds: ["assets.sample"], assetKinds: { "assets.sample": "image" },
  }];
  return resnapshot({ registry, libraries: structuredClone(libraries) as Mutable<ReviewLibrarySnapshot[]>, candidateId: candidate.id, digest: "", raisedAt });
}

export const field = (key: string, locale = "en", value = "Sample") => ({ key, locale, value, source: "writer" as const });
export function resnapshot(input: Fixture): Fixture {
  for (const candidate of input.registry.candidates) {
    const snapshot = createContentRevision(candidate, "r1", raisedAt);
    candidate.history = [structuredClone(snapshot) as Mutable<typeof snapshot>]; candidate.revision = "r1";
    if (candidate.approval) candidate.approval = { ...candidate.approval, revision: "r1", digest: snapshot.digest };
  }
  input.digest = computeContentDigest(input.registry.candidates.find(candidate => candidate.id === input.candidateId)!);
  return input;
}
export function addPeer(input: Fixture, overrides: Record<string, unknown> = {}): void {
  input.registry.slots.push({ ...structuredClone(input.registry.slots[0]!), id: peerSlotId, aliases: ["websites/site/peer"], name: "Peer", position: { order: 1, name: "peer" }, route: "/peer", ...overrides });
  delete input.registry.slots[1]!.activeCandidateId;
}
export function addPeerCandidate(input: Fixture): void {
  input.registry.candidates.push({ ...structuredClone(input.registry.candidates[0]!), id: "peer", slotId: peerSlotId });
  input.registry.slots[1]!.activeCandidateId = "peer";
}
export function allChecksFailingInput(): Fixture {
  const input = reviewInput(); const candidate = input.registry.candidates[0]!;
  input.registry.slots[0]!.kind = "redirect";
  candidate.composition!.frame.frameId = "frames.app-shell";
  candidate.composition!.sections.push({ ...structuredClone(candidate.composition!.sections[0]!), key: "unknown", sectionId: "sections.missing" });
  candidate.composition!.sections[0]!.fields = [field("title", "en", "This title exceeds the declared maximum"), field("unknown")];
  candidate.links = [{ toSlotId: "sl_zzzzzzzzzz", relation: "nav", intent: "Missing destination" }];
  addPeer(input, { route: "/home" });
  return resnapshot(input);
}
