import type { Composition, CopyField } from "./composition.js";
import type { ContentJson, ContentJsonObject, SourceAnswer } from "./json.js";
import type { ContentPlacement, SlotId } from "./taxonomy.js";
import type { CandidateOrigin, CandidateState, LinkRelation, RevisionId, SlotKind } from "./vocabulary.js";

export interface ContentWorkspace {
  readonly consumerId: string;
  readonly defaultLocale: string;
  readonly locales: readonly string[];
  readonly currentMilestoneTag?: string;
  readonly deployTargets: readonly { readonly id: string; readonly repo: string; readonly app: string; readonly builderSurfaceId?: string }[];
  readonly destinations: readonly { readonly id: string; readonly kind: "builder" | "messenger" | "influencer"; readonly ref: string }[];
}
export interface ContentBrief {
  readonly audience: string;
  readonly goal: string;
  readonly keyMessage: string;
  readonly callToAction: string;
  readonly tone: string;
  readonly constraints: readonly string[];
  readonly sourceAnswers: readonly SourceAnswer[];
  readonly version: number;
}
export interface ContentLink {
  readonly toSlotId: string;
  readonly relation: LinkRelation;
  readonly intent: string;
  readonly condition?: string;
  readonly offset?: ContentJson;
}
export interface ContentApproval {
  readonly by: string;
  readonly at: string;
  readonly revision: RevisionId;
  readonly digest: string;
  readonly source: "owner" | "imported-baseline";
}
export interface ContentOpenQuestion {
  readonly field: string;
  readonly question: string;
  readonly blocking: boolean;
}
/** Content fields are snapshotted; mutable tags and workflow metadata live outside. */
export interface CandidateContent {
  readonly name: string;
  readonly brief: ContentBrief;
  readonly composition?: Composition;
  readonly redirectTarget?: string;
  readonly pageMeta?: readonly CopyField[];
  readonly pageMetaAssets?: { readonly "og-image"?: string; readonly icon?: string };
  readonly links: readonly ContentLink[];
  readonly typeSettings: ContentJsonObject;
  readonly openQuestions: readonly ContentOpenQuestion[];
}
export interface ContentRevision {
  readonly revision: RevisionId;
  readonly digest: string;
  readonly content: CandidateContent;
  readonly createdAt: string;
}
export interface ContentCandidate extends CandidateContent {
  readonly id: string;
  readonly slotId: string;
  readonly origin: CandidateOrigin;
  readonly state: CandidateState;
  readonly revision: RevisionId;
  readonly derivedFrom?: { readonly candidateId: string; readonly revision: RevisionId };
  readonly approval?: ContentApproval;
  readonly tags: readonly string[];
  readonly history: readonly ContentRevision[];
  readonly updatedAt: string;
}
export interface ContentRelease {
  readonly n: number;
  readonly candidateId: string;
  readonly revision: RevisionId;
  readonly at: string;
}
export type ContentSlot = ContentPlacement & {
  /** Opaque identity; independent of placement, aliases, and routes. */
  readonly id: SlotId;
  readonly aliases: readonly string[];
  readonly locales: readonly string[];
  readonly position: { readonly order: number; readonly name: string };
  readonly name: string;
  readonly kind: SlotKind;
  readonly route?: string;
  readonly deployTarget?: string;
  readonly destination?: string;
  readonly meta?: { readonly robots?: "index" | "noindex"; readonly canonical?: string };
  readonly dynamicParams?: ContentJsonObject;
  readonly devOnly: boolean;
  readonly tags: readonly string[];
  readonly activeCandidateId?: string;
  readonly releases: readonly ContentRelease[];
  readonly createdAt: string;
};
export interface ContentRegistry {
  readonly workspace: ContentWorkspace;
  readonly slots: readonly ContentSlot[];
  readonly candidates: readonly ContentCandidate[];
}
