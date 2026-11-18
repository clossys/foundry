import { createContentRevision } from "../revisions.js";
import type { CandidateContent, ContentRegistry, ContentSlot } from "../model.js";
import type { ConsumerLibrarySnapshot } from "../library.js";

export const at = "2026-01-01T00:00:00Z";
export function reviewFixture(): ContentRegistry {
  const content: CandidateContent = {
    name: "Sample", brief: { audience: "Readers", goal: "Inform", keyMessage: "Sample", callToAction: "Continue", tone: "Clear", constraints: [], sourceAnswers: [], version: 1 },
    composition: { frame: { frameId: "frames.sample", configId: "default" }, sections: [{ key: "intro", sectionId: "sections.sample", configId: "default", intent: "continues", fields: [{ key: "heading", locale: "en", value: "Sample", source: "writer" }], assets: [{ assetId: "assets.sample", libraryVersion: "1" }] }], libraryVersion: "1" },
    pageMeta: [
      { key: "title", locale: "en", value: "Sample page", source: "writer" },
      { key: "description", locale: "en", value: "Sample description", source: "writer" },
    ],
    pageMetaAssets: { "og-image": "assets.sample", icon: "assets.sample" },
    links: [], typeSettings: { shareImage: { assetId: "assets.sample", libraryVersion: "1" } }, openQuestions: [],
  };
  const snapshot = createContentRevision(content, "r1", at);
  return {
    workspace: { consumerId: "sample", defaultLocale: "en", locales: ["en"], deployTargets: [], destinations: [] },
    slots: [{ id: "sl_fixturesaf", aliases: ["websites/site/home"], locales: ["en"], l1: "websites", l2: "site", position: { order: 0, name: "home" }, name: "Home", kind: "content", devOnly: false, tags: [], releases: [], createdAt: at, activeCandidateId: "sample" }],
    candidates: [{ ...structuredClone(content), id: "sample", slotId: "sl_fixturesaf", origin: "agent-draft", state: "active", revision: "r1", approval: { source: "owner", by: "owner", at, revision: "r1", digest: snapshot.digest }, tags: [], history: [snapshot], updatedAt: at }],
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

/** Inventory only: a slot does not assert that content exists or was approved. */
export function leafRegistryFixture(): ContentRegistry {
  type Leaf = readonly [
    id: ContentSlot["id"], board: "site" | "auth" | "admin", leaf: string,
    name: string, kind: ContentSlot["kind"], route?: string,
  ];
  const leaves: readonly Leaf[] = [
    ["sl_fixturesaf", "site", "home", "Home", "content", "/"],
    ["sl_fixturesaa", "site", "privacy", "Privacy", "content", "/privacy"],
    ["sl_fixturesah", "site", "terms", "Terms", "content", "/terms"],
    ["sl_fixturesaj", "site", "not-found", "Not found", "status"],
    ["sl_fixturesao", "auth", "sign-in", "Sign in", "content", "/sign-in"],
    ["sl_fixturesar", "auth", "sign-in-unavailable", "Sign in unavailable", "status", "/sign-in-unavailable"],
    ["sl_fixturesap", "auth", "not-authorized", "Not authorized", "status", "/not-authorized"],
    ["sl_fixturesab", "auth", "service-unavailable", "Service unavailable", "status", "/service-unavailable"],
    ["sl_fixturesae", "auth", "sign-out-confirm", "Sign out confirm", "content", "/sign-out-confirm"],
    ["sl_fixturesak", "auth", "not-found", "Not found", "status"],
    ["sl_fixturesan", "auth", "error", "Error", "status"],
    ["sl_fixturesaq", "auth", "global-error", "Global error", "status"],
    ["sl_fixturesal", "admin", "workspace-home", "Workspace home", "content", "/"],
    ["sl_fixturesad", "admin", "account", "Account", "content", "/account"],
    ["sl_fixturesac", "admin", "agents-designer", "Agents designer", "content", "/agents/designer"],
    ["sl_fixturesag", "admin", "agents-publisher", "Agents publisher", "content", "/agents/publisher"],
    ["sl_fixturesai", "admin", "agents-writer", "Agents writer", "content", "/agents/writer"],
    ["sl_fixturesam", "admin", "agents-foundry", "Agents foundry", "content", "/agents/foundry"],
  ];
  return {
    workspace: {
      consumerId: "sample", defaultLocale: "en", locales: ["en"],
      deployTargets: [
        { id: "product-site", repo: "sample", app: "site" },
        { id: "product-admin", repo: "sample", app: "admin" },
      ],
      destinations: [],
    },
    slots: leaves.map(([id, l2, leaf, name, kind, route], order) => ({
      id, aliases: [`websites/${l2}/${leaf}`], locales: ["en"],
      l1: "websites", l2, position: { order, name: leaf }, name, kind,
      ...(route === undefined ? {} : { route }),
      deployTarget: l2 === "site" ? "product-site" : "product-admin",
      devOnly: false, tags: leaf === "agents-foundry" ? ["parked"] : [],
      releases: [], createdAt: at,
    })),
    candidates: [],
  };
}
