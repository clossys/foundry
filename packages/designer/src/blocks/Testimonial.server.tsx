import { SemanticContent } from "../components/SemanticContent.js";
import type { ReactNode } from "react";
import { Avatar, AvatarFallback } from "../components/preview-runtime/components/avatar/avatar.js";
import { avatarInitials } from "../components/avatar-initials.js";
import { cx } from "../components/internal/cx.js";
import type { TestimonialBaseProps, TestimonialProps } from "./Testimonial.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";

/**
 * The stock Avatar with a server-safe image child (the stock AvatarImage holds client
 * load state), so both variants render identical markup; initials when there is no image.
 */
export function testimonialAvatar(alt: string, src: string | undefined): ReactNode {
  return src
    ? <Avatar><img src={src} alt={alt} className="h-full w-full rounded-full object-cover" /></Avatar>
    : <Avatar role="img" aria-label={alt}><AvatarFallback aria-hidden="true">{avatarInitials(alt)}</AvatarFallback></Avatar>;
}

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
        <SemanticContent as="div" className="flex flex-col">
          <SemanticContent as="span" className={cx("text-body font-body font-medium", colors.primary)}>{attributorName}</SemanticContent>
          {attributorRole ? (
            <SemanticContent as="span" className={cx("text-body-s", colors.secondary)}>{attributorRole}</SemanticContent>
          ) : null}
        </SemanticContent>
      </figcaption>
    </figure>
  );
}

/** Server-safe variant; the client variant retains image-load-failure handling. */
export function Testimonial({ avatarSrc, avatarAlt, ...props }: TestimonialProps) {
  return renderTestimonial(
    props,
    avatarAlt ? testimonialAvatar(avatarAlt, avatarSrc) : null,
  );
}
