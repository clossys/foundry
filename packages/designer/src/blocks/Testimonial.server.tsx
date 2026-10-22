import type { ReactNode } from "react";
import { Avatar } from "../atoms/Avatar.server.js";
import { cx } from "../atoms/internal/cx.js";
import type { TestimonialBaseProps, TestimonialProps } from "./Testimonial.js";

/** One markup recipe for both variants; each supplies its own Avatar. */
export function renderTestimonial(
  {
    quote,
    attributorName,
    attributorRole,
    className,
    style,
    ...rest
  }: TestimonialBaseProps,
  avatar: ReactNode,
) {
  return (
    <figure {...rest} className={cx("flex flex-col gap-md", className)} style={style}>
      <blockquote className="text-blockquote font-display text-ink-primary">{quote}</blockquote>
      <figcaption className="flex items-center gap-sm">
        {avatar}
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

/** Server-safe variant; the client variant retains image-load-failure handling. */
export function Testimonial({ avatarSrc, avatarAlt, ...props }: TestimonialProps) {
  return renderTestimonial(
    props,
    avatarAlt ? <Avatar alt={avatarAlt} src={avatarSrc} /> : null,
  );
}
