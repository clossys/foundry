import type { ContentFinding, CopyFinding, ContentWriterContext } from "../composition.js";
import type { ContentRegistry, ContentSlot } from "../model.js";
import type { ReviewReport } from "../review/types.js";
import type { RevisionId } from "../vocabulary.js";

/** Explicit selected active candidates; unselected slots are not silently released. */
export interface ReleaseInput {
  readonly registry: ContentRegistry;
  readonly selections: readonly { readonly candidateId: string; readonly review: ReviewReport }[];
  readonly approvedBy: string;
  /** Finite Writer registries and locale policy; approval time is at. */
  readonly writer?: ContentWriterContext;
  readonly at: string;
}
export interface ReleaseManifest {
  readonly targetId: string;
  readonly n: number;
  readonly at: string;
  readonly entries: readonly { readonly slotId: string; readonly candidateId: string; readonly revision: RevisionId; readonly digest: string; readonly route?: string }[];
  readonly approvedBy: string;
  /** SHA256 of canonical JSON of every other manifest field. */
  readonly digest: string;
}
export interface TargetBuildManifest {
  readonly targetId: string;
  readonly releaseN: number;
  readonly routes: readonly {
    readonly slotId: string;
    /** Undefined for framework-boundary slots, never an invented public URL. */
    readonly path?: string;
    readonly kind: ContentSlot["kind"];
    readonly locales: readonly string[];
    readonly revision: RevisionId;
    readonly digest: string;
  }[];
}
/** A pending local stub is never proof that a receiver observed or deployed bytes. */
export interface HandoverReceipt {
  readonly targetId: string;
  readonly releaseN: number;
  readonly receiver: "builder" | "messenger" | "influencer";
  readonly matches: false;
  readonly status: "pending";
  readonly observedAt: null;
}
export interface ReleaseBundle {
  readonly manifest: ReleaseManifest;
  readonly build: TargetBuildManifest;
  readonly handover: HandoverReceipt;
}
export type ReleaseResult =
  | { readonly ok: true; readonly releases: readonly ReleaseBundle[]; readonly findings: readonly []; readonly copyFindings?: readonly CopyFinding[] }
  | { readonly ok: false; readonly releases: readonly []; readonly findings: readonly ContentFinding[]; readonly copyFindings?: readonly CopyFinding[] };
