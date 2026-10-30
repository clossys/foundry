import { SemanticContent } from "../components/SemanticContent.js";
import type { ReactNode } from "react";
import { Avatar } from "../components/Avatar.server.js";
import { cx } from "../components/internal/cx.js";
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
    <SemanticContent as="figure" {...rest} className={cx("flex flex-col gap-md", className)} style={style}>
      <blockquote className={cx("text-blockquote font-display", colors.primary)}>{quote}</blockquote>
      <SemanticContent as="figcaption" className="flex items-center gap-sm">
        {avatar}
        <SemanticContent as="div" className="flex flex-col">
          <SemanticContent as="span" className={cx("text-body font-body font-medium", colors.primary)}>{attributorName}</SemanticContent>
          {attributorRole ? (
            <SemanticContent as="span" className={cx("text-body-s", colors.secondary)}>{attributorRole}</SemanticContent>
          ) : null}
        </SemanticContent>
      </SemanticContent>
    </SemanticContent>
  );
}

/** Server-safe variant; the client variant retains image-load-failure handling. */
export function Testimonial({ avatarSrc, avatarAlt, ...props }: TestimonialProps) {
  return renderTestimonial(
    props,
    avatarAlt ? <Avatar alt={avatarAlt} src={avatarSrc} /> : null,
  );
}
