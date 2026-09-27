import type { ReactNode } from "react";
import { PageHeader } from "@clossys/designer/blocks/server";

export interface SystemAuditViewProps {
  title: string;
  galleryHref: string;
  brandOk: boolean;
  brandFindings: readonly string[];
  contrastFindings: readonly string[];
  /** Visible text of the preview-gallery link. @default "Preview gallery" */
  galleryLabel?: string;
  /** Accessible name for the brand-file section. @default "Brand file" */
  brandSectionLabel?: string;
  /** Accessible name for the contrast section. @default "Contrast" */
  contrastLabel?: string;
  /**
   * Coverage status under the page title.
   * @default "Brand file coverage passed." when brandOk is true, otherwise "Brand file coverage failed."
   */
  coverageDescription?: (brandOk: boolean) => string;
}

function defaultCoverageDescription(brandOk: boolean): string {
  return brandOk ? "Brand file coverage passed." : "Brand file coverage failed.";
}

/** Internal audit: the preview gallery plus brand-file and contrast results. One map entry, not a hand-built admin page. */
export function SystemAuditView({
  title,
  galleryHref,
  brandOk,
  brandFindings,
  contrastFindings,
  galleryLabel = "Preview gallery",
  brandSectionLabel = "Brand file",
  contrastLabel = "Contrast",
  coverageDescription = defaultCoverageDescription,
}: SystemAuditViewProps): ReactNode {
  return (
    <main>
      <PageHeader title={title} description={coverageDescription(brandOk)} />
      <p>
        <a href={galleryHref}>{galleryLabel}</a>
      </p>
      <section aria-label={brandSectionLabel}>
        <ul>
          {brandFindings.map((finding) => (
            <li key={finding}>{finding}</li>
          ))}
        </ul>
      </section>
      <section aria-label={contrastLabel}>
        <ul>
          {contrastFindings.map((finding) => (
            <li key={finding}>{finding}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
