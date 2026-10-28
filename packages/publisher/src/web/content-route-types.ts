import type { ReactElement } from "react";
import type { Composition, CopyField, CopyFinding, ContentWriterContext } from "../content/composition.js";
import type { ContentCandidate, ContentRegistry, ContentSlot } from "../content/model.js";
import type { ConsumerLibrarySnapshot } from "../content/library.js";
import type { RevisionId } from "../content/vocabulary.js";

export interface ContentRouteNeed {
  readonly id: string;
  readonly kind: "frame" | "section" | "config" | "asset" | "copy";
  readonly target: "designer" | "writer";
  readonly slotId: string;
  readonly ref?: string;
  readonly detail: string;
  readonly raisedAt: string;
}
export interface ContentRouteInput {
  readonly registry: ContentRegistry;
  readonly slotId: string;
  readonly locale: string;
  readonly libraries: readonly ConsumerLibrarySnapshot[];
  /** Temporary read-only Writer projection; persistence belongs to a later content unit. */
  readonly frameCopy?: readonly CopyField[];
  readonly assets?: readonly { readonly assetId: string; readonly libraryVersion: string; readonly src: string }[];
  /** Finite Writer registries and locale policy; approval time is raisedAt. */
  readonly writer?: ContentWriterContext;
  readonly raisedAt: string;
}
export interface ContentRouteMetadata {
  readonly title?: string;
  readonly description?: string;
  readonly robots: "index" | "noindex";
  readonly canonical?: string;
}
export interface ContentRouteSelection {
  readonly slot: ContentSlot;
  readonly candidate: ContentCandidate;
  readonly locale: string;
  readonly outputPath: string;
}
export interface PreparedContentRoute extends ContentRouteSelection {
  readonly status: "ready" | "needs-input";
  readonly metadata: ContentRouteMetadata;
  readonly needs: readonly ContentRouteNeed[];
  readonly copyFindings?: readonly CopyFinding[];
  readonly node?: ReactElement;
}
/** Version 2 is independent of the retiring plan/layout registration contract. */
export interface ContentRouteRegistration {
  readonly kind: "content";
  readonly slotId: string;
  readonly candidateId: string;
  readonly revision: RevisionId;
  readonly digest: string;
  readonly locale: string;
  readonly path: string;
  readonly outputPath: string;
  readonly composition: Composition;
  readonly source: { readonly file: string; readonly export: "default" };
  readonly loader: { readonly file: string; readonly export: string };
}
export interface ContentRouteManifest {
  readonly version: 2;
  readonly consumer: string;
  readonly routes: readonly ContentRouteRegistration[];
}
