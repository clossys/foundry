import type { CandidateContent, ContentCandidate } from "../../content/model.js";
import type { CopyField } from "../../content/composition.js";
import { createContentRevision } from "../../content/revisions.js";
import type { ContentRouteInput } from "../content-route-types.js";

export const CONTENT_ROUTE_AT = "2026-01-01T00:00:00Z";
export const CONTENT_ROUTE_SLOT = "sl_aaaaaaaaaa";
export const writerField = (key: string, value: string, locale = "en"): CopyField => ({ key, value, locale, source: "writer" });

/** Synthetic content, not an approval or a publication qualification. */
export function contentRouteContent(overrides: Partial<CandidateContent> = {}): CandidateContent {
  return {
    name: "Sign in", brief: { audience: "Returning readers", goal: "Explain the sign-in state", keyMessage: "Continue when ready", callToAction: "Continue", tone: "Clear", constraints: [], sourceAnswers: [], version: 1 },
    composition: { frame: { frameId: "frames.auth-shell", configId: "default" }, libraryVersion: "1", sections: [{ key: "message", sectionId: "sections.empty-state", configId: "default", intent: "continues", fields: [writerField("title", "Sign in to continue"), writerField("description", "Your account is ready.")] }] },
    pageMeta: [writerField("title", "Sign in | Example"), writerField("description", "Continue to your account.")],
    links: [], typeSettings: {}, openQuestions: [], ...overrides,
  };
}
export function contentRouteCandidate(content: CandidateContent, id = "sign-in", slotId = CONTENT_ROUTE_SLOT, state: ContentCandidate["state"] = "active"): ContentCandidate {
  const snapshot = createContentRevision(content, "r1", CONTENT_ROUTE_AT);
  return { ...snapshot.content, id, slotId, origin: "agent-draft", state, revision: snapshot.revision, tags: [], history: [snapshot], updatedAt: CONTENT_ROUTE_AT };
}
export function contentRouteFixture(overrides: Partial<CandidateContent> = {}): ContentRouteInput {
  return {
    registry: {
      workspace: { consumerId: "example", defaultLocale: "en", locales: ["en", "fr"], deployTargets: [{ id: "site", repo: "example", app: "site" }], destinations: [] },
      slots: [{ id: CONTENT_ROUTE_SLOT, aliases: ["websites/auth/sign-in"], locales: ["en"], l1: "websites", l2: "auth", position: { order: 0, name: "sign-in" }, name: "Sign in", kind: "content", route: "/sign-in", deployTarget: "site", meta: { canonical: "https://example.test/sign-in" }, devOnly: false, tags: [], activeCandidateId: "sign-in", releases: [], createdAt: CONTENT_ROUTE_AT }],
      candidates: [contentRouteCandidate(contentRouteContent(overrides))],
    },
    slotId: CONTENT_ROUTE_SLOT, locale: "en", raisedAt: CONTENT_ROUTE_AT,
    libraries: [{ consumerId: "example", version: "1", frames: [{ id: "frames.auth-shell", configIds: ["default"] }], sections: [{ id: "sections.empty-state", configIds: ["default"] }], assetIds: [] }],
    frameCopy: [writerField("skipLabel", "Skip to sign-in content")], assets: [],
  };
}
/** Replace content through the real immutable revision constructor. */
export function withRouteContent(input: ContentRouteInput, content: CandidateContent): ContentRouteInput {
  return { ...input, registry: { ...input.registry, candidates: input.registry.candidates.map(candidate => candidate.id === "sign-in" ? contentRouteCandidate(content) : candidate) } };
}
