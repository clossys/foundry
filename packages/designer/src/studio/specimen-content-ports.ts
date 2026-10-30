import type { ReactNode } from "react";

/** Native Producer response fields; Designer never loads or serves the publication. */
export interface SpecimenPublishedPage {
  readonly id: string;
  readonly route: string;
  readonly previewUrl: string;
  readonly emitted: boolean;
  readonly stage: string;
}
/** A confirmed missing publication, supplied by the caller's native inventory reader.
 * Unknown inventory and failed reads must not be converted into this state. */
export interface SpecimenUnpublishedPage {
  readonly publication: "unpublished";
  readonly emitted: false;
  readonly id: string;
  readonly route: string;
  readonly emptyState: {
    readonly title: string;
    readonly description: string;
    readonly command: string;
    readonly context: string;
  };
}
export type SpecimenPreviewPage = SpecimenPublishedPage | SpecimenUnpublishedPage;
/** The host supplies its actual guarded emitted-page engine. */
export interface SpecimenPagePreviewPort {
  readonly engine: "producer-emitted-page@1";
  readonly origin: string;
  readonly pages: readonly SpecimenPreviewPage[];
  renderViewport(input: {
    readonly page: SpecimenPublishedPage;
    readonly viewport: { readonly id: string; readonly label: string; readonly width: number; readonly height: number };
    readonly interactive: false;
    readonly fullSize: boolean;
  }): ReactNode;
}
