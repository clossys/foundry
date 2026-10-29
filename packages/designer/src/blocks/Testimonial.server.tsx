import type { ReactNode } from "react";
import { Avatar } from "../selected-components/Avatar.server.js";
import { cx } from "../selected-components/internal/cx.js";
import type { TestimonialBaseProps, TestimonialProps } from "./Testimonial.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";

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
  ground: SectionGround = "base",
) {
  const colors = SECTION_GROUND_CLASSES[ground];
  return (
    <figure {...rest} className={cx("flex flex-col gap-md", className)} style={style}>
      <blockquote className={cx("text-blockquote font-display", colors.primary)}>{quote}</blockquote>
      <figcaption className="flex items-center gap-sm">
        {avatar}
        <div className="flex flex-col">
          <span className={cx("text-body font-body font-medium", colors.primary)}>{attributorName}</span>
          {attributorRole ? (
            <span className={cx("text-body-s", colors.secondary)}>{attributorRole}</span>
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
