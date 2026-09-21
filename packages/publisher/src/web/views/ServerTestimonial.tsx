import type { ReactNode } from "react";

/**
 * Server-safe testimonial markup aligned with Designer `Testimonial` when no
 * avatar is supplied. Designer `Testimonial` is client-only because `Avatar`
 * reads `useState` at module scope; SectionedView's react-server entry uses
 * this twin so SSR output matches the client block's no-avatar branch.
 */
export interface ServerTestimonialProps {
  quote: ReactNode;
  attributorName: ReactNode;
  attributorRole?: ReactNode;
  className?: string;
}

export function ServerTestimonial({
  quote,
  attributorName,
  attributorRole,
  className,
}: ServerTestimonialProps) {
  return (
    <figure className={["flex flex-col gap-md", className].filter(Boolean).join(" ")}>
      <blockquote className="text-blockquote font-display text-ink-primary">{quote}</blockquote>
      <figcaption className="flex items-center gap-sm">
        <div className="flex flex-col">
          <span className="text-body font-body font-medium text-ink-primary">{attributorName}</span>
          {attributorRole ? (
            <span className="text-body-s text-ink-secondary">{attributorRole}</span>
          ) : null}
        </div>
      </figcaption>
    </figure>
  );
}
