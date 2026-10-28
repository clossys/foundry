import { createContentRevision } from "../revisions.js";
import type { CandidateContent, ContentRegistry, ContentSlot } from "../model.js";
import type { ConsumerLibrarySnapshot } from "../library.js";

export const at = "2026-01-01T00:00:00Z";
export function reviewFixture(): ContentRegistry {
  const content: CandidateContent = {
    name: "Sample", brief: { audience: "Readers", goal: "Inform", keyMessage: "Sample", callToAction: "Continue", tone: "Clear", constraints: [], sourceAnswers: [], version: 1 },
    composition: { frame: { frameId: "frames.sample", configId: "default" }, sections: [{ key: "intro", sectionId: "sections.sample", configId: "default", intent: "continues", fields: [{ key: "heading", locale: "en", value: "Sample", source: "writer" }], assets: [{ assetId: "assets.sample", libraryVersion: "1" }] }], libraryVersion: "1" },
    links: [], typeSettings: { shareImage: { assetId: "assets.sample", libraryVersion: "1" } }, openQuestions: [],
  };
  const snapshot = createContentRevision(content, "r1", at);
  return {
    workspace: { consumerId: "sample", defaultLocale: "en", locales: ["en"], deployTargets: [], destinations: [] },
    slots: [{ id: "sl_boyi4ashca", aliases: ["websites/site/home"], locales: ["en"], l1: "websites", l2: "site", position: { order: 0, name: "home" }, name: "Home", kind: "content", devOnly: false, tags: [], releases: [], createdAt: at, activeCandidateId: "sample" }],
    candidates: [{ ...structuredClone(content), id: "sample", slotId: "sl_boyi4ashca", origin: "agent-draft", state: "active", revision: "r1", approval: { source: "owner", by: "owner", at, revision: "r1", digest: snapshot.digest }, tags: [], history: [snapshot], updatedAt: at }],
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
    ["sl_boyi4ashca", "site", "home", "Home", "content", "/"],
    ["sl_2xv4y3uo7k", "site", "privacy", "Privacy", "content", "/privacy"],
    ["sl_ke6mhs5hmu", "site", "terms", "Terms", "content", "/terms"],
    ["sl_prd6v4nkk3", "site", "not-found", "Not found", "status"],
    ["sl_wl546svpom", "auth", "sign-in", "Sign in", "content", "/sign-in"],
    ["sl_x5c5vjqxez", "auth", "sign-in-unavailable", "Sign in unavailable", "status", "/sign-in-unavailable"],
    ["sl_wlpwozbd7y", "auth", "not-authorized", "Not authorized", "status", "/not-authorized"],
    ["sl_4hiswon2mp", "auth", "service-unavailable", "Service unavailable", "status", "/service-unavailable"],
    ["sl_asgvb7lcju", "auth", "sign-out-confirm", "Sign out confirm", "content", "/sign-out-confirm"],
    ["sl_pwsyw4hn2e", "auth", "not-found", "Not found", "status"],
    ["sl_w7u7k6agdr", "auth", "error", "Error", "status"],
    ["sl_wnelzobehr", "auth", "global-error", "Global error", "status"],
    ["sl_rkjigy5k5p", "admin", "workspace-home", "Workspace home", "content", "/"],
    ["sl_7pz5qp7kyz", "admin", "account", "Account", "content", "/account"],
    ["sl_622lk7eoar", "admin", "agents-designer", "Agents designer", "content", "/agents/designer"],
    ["sl_hfkj3prso2", "admin", "agents-publisher", "Agents publisher", "content", "/agents/publisher"],
    ["sl_lsqwmhpf6l", "admin", "agents-writer", "Agents writer", "content", "/agents/writer"],
    ["sl_sjhh4tpouv", "admin", "agents-foundry", "Agents foundry", "content", "/agents/foundry"],
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
