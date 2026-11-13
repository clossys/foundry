import { isContentJson } from "../../content/json.js";
import type { ContentCandidate } from "../../content/model.js";
import { parseContentRegistry } from "../../content/validate.js";
import { isRevisionId } from "../../content/vocabulary.js";
import type { RevisionId } from "../../content/vocabulary.js";
import type { ContentRouteInput } from "../content-route-types.js";

export class ContentPreviewRefusal extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ContentPreviewRefusal";
    this.code = code;
  }
}

export interface ContentPreviewSelection {
  readonly candidateId?: string;
  readonly revision?: RevisionId;
}

/** Select a transient renderer view without changing stored content or granting approval. */
export function previewContentRouteInput(input: ContentRouteInput, selection: ContentPreviewSelection = {}): ContentRouteInput {
  if (!isContentJson(input.registry)) throw new TypeError("A finite content registry is required");
  // Validate the source first so a display projection cannot repair invalid workflow data.
  const registry = parseContentRegistry(input.registry);
  const slot = registry.slots.find(entry => entry.id === input.slotId || entry.aliases.includes(input.slotId));
  if (!slot) throw new ContentPreviewRefusal("unknown-slot", "A registered preview slot or alias is required");
  if (slot.l1 !== "websites") throw new ContentPreviewRefusal("unsupported-medium", "Raw preview currently supports website slots");
  if (!slot.locales.includes(input.locale) || !registry.workspace.locales.includes(input.locale)) {
    throw new ContentPreviewRefusal("unsupported-locale", "The preview locale must be declared by the slot and workspace");
  }
  const canonicalInput = input.slotId === slot.id ? input : { ...input, slotId: slot.id };
  const candidateId = selection.candidateId ?? slot.activeCandidateId;
  if (candidateId === undefined) throw new ContentPreviewRefusal("no-active-candidate", "The preview slot has no active candidate");
  const candidate = registry.candidates.find(entry => entry.slotId === slot.id && entry.id === candidateId);
  if (!candidate) throw new ContentPreviewRefusal("unknown-candidate", "The preview candidate must belong to the selected slot");
  if (selection.candidateId === undefined && selection.revision === undefined) return canonicalInput;

  const revision = selection.revision ?? candidate.revision;
  if (!isRevisionId(revision)) throw new ContentPreviewRefusal("unknown-revision", "A pinned preview revision is required");
  const snapshotIndex = candidate.history.findIndex(entry => entry.revision === revision);
  const snapshot = candidate.history[snapshotIndex];
  if (!snapshot) throw new ContentPreviewRefusal("unknown-revision", "The preview revision must belong to the selected candidate");
  // Only snapshot content supplies content fields: absent historical fields stay absent.
  const displayed: ContentCandidate = {
    ...snapshot.content,
    id: candidate.id,
    slotId: candidate.slotId,
    origin: candidate.origin,
    state: "active",
    revision: snapshot.revision,
    ...(candidate.derivedFrom === undefined ? {} : { derivedFrom: candidate.derivedFrom }),
    ...(candidate.approval === undefined ? {} : { approval: candidate.approval }),
    tags: candidate.tags,
    history: candidate.history.slice(0, snapshotIndex + 1),
    updatedAt: candidate.updatedAt,
  };
  return {
    ...canonicalInput,
    registry: {
      ...registry,
      // Release records are not evidence for this transient historical display view.
      // The source slot retains its complete, unchanged release history.
      slots: registry.slots.map(entry => entry.id === slot.id ? { ...entry, activeCandidateId: candidate.id, releases: [] } : entry),
      candidates: registry.candidates.map(entry => entry.id === candidate.id ? displayed
        : entry.slotId === slot.id && entry.state === "active" ? { ...entry, state: "draft" } : entry),
    },
  };
}
