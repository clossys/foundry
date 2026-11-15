import type { ReactNode } from "react";

/** Native Producer response fields; Designer never loads or serves the publication. */
export interface SpecimenPublishedPage {
  readonly id: string;
  readonly route: string;
  readonly previewUrl: string;
  readonly emitted: boolean;
  readonly stage: string;
}
/** The host supplies its actual guarded emitted-page engine. */
export interface SpecimenPagePreviewPort {
  readonly engine: "producer-emitted-page@1";
  readonly origin: string;
  readonly pages: readonly SpecimenPublishedPage[];
  renderViewport(input: {
    readonly page: SpecimenPublishedPage;
    readonly viewport: { readonly id: string; readonly label: string; readonly width: number; readonly height: number };
    readonly interactive: false;
    readonly fullSize: boolean;
  }): ReactNode;
}
