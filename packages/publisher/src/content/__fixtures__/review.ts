import { createContentRevision } from "../revisions.js";
import type { CandidateContent, ContentRegistry } from "../model.js";
import type { ConsumerLibrarySnapshot } from "../library.js";

export const at = "2026-01-01T00:00:00Z";
export function reviewFixture(): ContentRegistry {
  const content: CandidateContent = {
    name: "Sample", brief: { audience: "Readers", goal: "Inform", keyMessage: "Sample", callToAction: "Continue", tone: "Clear", constraints: [], sourceAnswers: [], version: 1 },
    composition: { frame: { frameId: "frames.sample", configId: "default" }, sections: [{ key: "intro", sectionId: "sections.sample", configId: "default", intent: "continues", fields: [{ field: "heading", text: "Sample", source: "handwritten", assets: [{ assetId: "assets.sample", libraryVersion: "1" }] }] }], libraryVersion: "1" },
    links: [], typeSettings: { shareImage: { assetId: "assets.sample", libraryVersion: "1" } }, openQuestions: [],
  };
  const snapshot = createContentRevision(content, "r1", at);
  return {
    workspace: { consumerId: "sample", deployTargets: [], destinations: [] },
    slots: [{ id: "websites/site/home", l1: "websites", l2: "site", position: { order: 0, name: "home" }, name: "Home", kind: "content", devOnly: false, tags: [], releases: [], createdAt: at, activeCandidateId: "sample" }],
    candidates: [{ ...structuredClone(content), id: "sample", slotId: "websites/site/home", origin: "agent-draft", state: "active", revision: "r1", approval: { source: "owner", by: "owner", at, revision: "r1", digest: snapshot.digest }, tags: [], history: [snapshot], updatedAt: at }],
  };
}
export function libraryFixture(): ConsumerLibrarySnapshot[] {
  return [{ consumerId: "sample", version: "1", frames: [{ id: "frames.sample", configIds: ["default"] }], sections: [{ id: "sections.sample", configIds: ["default"] }], assetIds: ["assets.sample"] }];
}

export function pinnedReviewFixture(): ContentRegistry {
  const registry = reviewFixture();
  const candidate = registry.candidates[0]!;
  const content = { ...candidate, composition: { ...candidate.composition!, sections: [{ ...candidate.composition!.sections[0]!, ref: { candidateId: "source", revision: "r1" as const, sectionKey: "intro" } }] } };
  const snapshot = createContentRevision(content, "r1", at);
  return { ...registry, candidates: [{ ...content, history: [snapshot], approval: { ...candidate.approval!, digest: snapshot.digest } }, { ...candidate, id: "source", state: "draft" }] };
}
