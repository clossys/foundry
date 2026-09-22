import type { ReactNode } from "react";
import { PageHeader } from "@clossys/designer/blocks/server";

export interface SystemAuditViewProps {
  title: string;
  galleryHref: string;
  brandOk: boolean;
  brandFindings: readonly string[];
  contrastFindings: readonly string[];
}

/** Internal audit: the preview gallery plus brand-file and contrast results. One map entry, not a hand-built admin page. */
export function SystemAuditView({ title, galleryHref, brandOk, brandFindings, contrastFindings }: SystemAuditViewProps): ReactNode {
  return (
    <main>
      <PageHeader title={title} description={brandOk ? "Brand file coverage passed." : "Brand file coverage failed."} />
      <p>
        <a href={galleryHref}>Preview gallery</a>
      </p>
      <section aria-label="Brand file">
        <ul>
          {brandFindings.map((finding) => (
            <li key={finding}>{finding}</li>
          ))}
        </ul>
      </section>
      <section aria-label="Contrast">
        <ul>
          {contrastFindings.map((finding) => (
            <li key={finding}>{finding}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
