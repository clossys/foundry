import type { CandidateContent, ContentCandidate } from "../../content/model.js";
import type { CopyField } from "../../content/composition.js";
import { createContentRevision } from "../../content/revisions.js";
import type { ContentRouteInput } from "../content-route-types.js";
import { COPY_FINGERPRINT_ALGORITHM, computeCopyFingerprint } from "@clossys/writer";
import type { CopyRegistry } from "@clossys/writer";

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

/** Migrate synthetic inline fixture text to actual fingerprint-approved Writer registries. */
export function withApprovedRouteCopy(input: ContentRouteInput): ContentRouteInput {
  const registries = new Map<string, CopyRegistry>([input.writer?.registry, ...input.writer?.registries ?? []]
    .filter((registry): registry is CopyRegistry => registry !== undefined).map(registry => [registry.locale, structuredClone(registry)]));
  const refs = new Map<string, string>();
  const fields = (values: readonly CopyField[]): readonly CopyField[] => values.map(field => {
    if (field.ref !== undefined) return field;
    const identity = JSON.stringify([field.key, field.locale, field.value]);
    let id = refs.get(identity);
    if (id === undefined) {
      id = `route.fixture.${refs.size}`;
      // A second migration can extend an already bound fixture without reusing its ids.
      while ([...registries.values()].some(registry => registry.entries.some(entry => entry.id === id))) id += ".next";
      refs.set(identity, id);
      const registry = registries.get(field.locale) ?? { id: `route-fixture-${field.locale}`, locale: field.locale, revision: "r1",
        source: { kind: "consumer" as const, reference: "fixtures/content-route" }, entries: [] };
      registries.set(field.locale, { ...registry, entries: [...registry.entries, {
        id, text: field.value, context: "Synthetic content route copy", placeholders: [], status: "approved",
        approval: { approvedBy: "owner", approvedAt: input.raisedAt, textFingerprint: computeCopyFingerprint(field.value), fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM },
      }] });
    }
    return { key: field.key, locale: field.locale, source: "writer", ref: { id } };
  });
  const content = <T extends CandidateContent>(value: T): T => ({ ...value,
    ...(value.pageMeta === undefined ? {} : { pageMeta: fields(value.pageMeta) }),
    ...(value.composition === undefined ? {} : { composition: { ...value.composition,
      sections: value.composition.sections.map(section => ({ ...section, fields: fields(section.fields) })) } }),
  });
  const candidates = input.registry.candidates.map(candidate => ({ ...content(candidate),
    history: candidate.history.map(snapshot => createContentRevision(content(snapshot.content), snapshot.revision, snapshot.createdAt)),
  }));
  const frameCopy = input.frameCopy === undefined ? undefined : fields(input.frameCopy);
  const [registry, ...others] = registries.values();
  if (!registry) throw new TypeError("Fixture migration requires copy fields");
  return { ...input, registry: { ...input.registry, candidates }, frameCopy,
    writer: { ...input.writer, registry, registries: others } };
}
