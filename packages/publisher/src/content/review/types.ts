import type { CompositionSection, ContentFinding } from "../composition.js";
import type { ConsumerLibrarySnapshot } from "../library.js";
import type { ContentCandidate, ContentRegistry, ContentSlot } from "../model.js";
import type { RevisionId } from "../vocabulary.js";

export type ReviewCheck = "closed-world" | "copy-schema" | "locale-coverage" | "links" | "url-collision" | "frame-per-l2" | "redirect";
export interface ReviewFinding extends ContentFinding { readonly check: ReviewCheck }
/** A declared DG-1 snapshot, with no Designer runtime dependency. */
export interface ReviewCopySchema {
  readonly sourceLocale: string;
  readonly fields: readonly {
    readonly key: string;
    readonly kind: "plain" | "rich" | "icu";
    readonly required: boolean;
    readonly maxLength: Readonly<Record<string, number>>;
    readonly dir: "ltr" | "rtl" | "auto";
  }[];
}
export interface ReviewSectionRegistration {
  readonly id: string;
  readonly configIds: readonly string[];
  readonly passageSchema?: string;
  readonly copy?: ReviewCopySchema;
  readonly slots?: readonly { readonly name: string; readonly required: boolean; readonly type?: string }[];
  readonly assetKinds?: readonly string[];
  /** Explicit config-specific contracts; never infer a logo-only copy exception. */
  readonly configSchemas?: readonly { readonly configId: string; readonly passageSchema: string; readonly copy: ReviewCopySchema; readonly slots?: ReviewSectionRegistration["slots"]; readonly assetKinds?: readonly string[] }[];
}
/** Local enrichment leaves the existing closed-world snapshot contract unchanged. */
export interface ReviewLibrarySnapshot extends ConsumerLibrarySnapshot {
  readonly sections: readonly ReviewSectionRegistration[];
  readonly assetKinds?: Readonly<Record<string, string>>;
}
export interface Need {
  readonly id: string;
  readonly slotId: string;
  readonly kind: "section" | "config" | "frame" | "asset" | "copy-schema" | "copy";
  readonly target: "designer" | "writer";
  readonly ref?: string;
  readonly detail: string;
  readonly raisedAt: string;
}
export interface ReviewInput {
  readonly registry: ContentRegistry;
  readonly candidateId: string;
  readonly libraries: readonly ReviewLibrarySnapshot[];
  /** Current content digest computed upstream, not guessed from approval metadata. */
  readonly digest: string;
  readonly raisedAt: string;
}
export interface ReviewReport {
  readonly candidateId: string;
  readonly revision: RevisionId;
  readonly digest: string;
  readonly findings: readonly ReviewFinding[];
  readonly needs: readonly Need[];
  readonly checkedAgainst: { readonly libraryVersion: string | null; readonly locales: readonly string[] };
}
export interface ResolvedReviewSection {
  readonly section: CompositionSection;
  readonly path: string;
  readonly library?: ReviewLibrarySnapshot;
  readonly registration?: ReviewSectionRegistration;
}
/** Internal plumbing shared by disjoint review checks. */
export interface ReviewContext {
  readonly input: ReviewInput;
  readonly registry: ContentRegistry;
  readonly candidate: ContentCandidate;
  readonly slot: ContentSlot;
  sections: readonly ResolvedReviewSection[];
  add(check: ReviewCheck, path: string, rule: string, message: string): void;
  need(kind: Need["kind"], target: Need["target"], reference: string, detail: string): void;
}
