import { useState } from "react";
import type { HTMLAttributes } from "react";
import { cx } from "./internal/cx.js";
import { AVATAR_BASE_CLASSES, AVATAR_IMAGE_CLASSES, AVATAR_SIZE_CLASSES, avatarInitials } from "./Avatar.server.js";

export type AvatarSize = "sm" | "md" | "lg";

export interface AvatarProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /**
   * Required. The person or thing this avatar represents, in words — used
   * as the rendered `<img>`'s `alt` text, and to derive the initials shown
   * when there's no image (or the image fails to load). There is no
   * `children` slot: unlike `Badge`/`Card`, an avatar's content is always
   * exactly one of "this image" or "these initials," never arbitrary
   * markup, so there's nothing a slot would let a consumer do that `src`
   * plus this required name doesn't already cover.
   */
  alt: string;
  /** Image URL. Omit to always show the initials fallback. */
  src?: string;
  /** @default "md" */
  size?: AvatarSize;
}

/**
 * A person's (or thing's) picture, with an initials fallback when there's
 * no image, no `src` was given, or the image fails to load. Not interactive
 * and does not compose another component — plain markup, no react-aria-components
 * primitive needed, unlike `Button` and `TextField` (see this package's
 * README) — the same reasoning as `Badge` and `Card`.
 *
 * When an image renders, it alone carries the accessible name (a real
 * `<img alt="...">`). When the initials fallback renders instead, the
 * initials text is decorative (`aria-hidden`) and the outer element carries
 * `role="img"` + `aria-label` instead — the same accessible name either way,
 * on whichever element is actually presenting it, rather than announcing
 * both at once.
 *
 * Not server-safe (the load-failure fallback is state). The server-safe
 * variant, without that fallback, is `Avatar.server.tsx`, re-exported as
 * `Avatar` from `components/server.ts`.
 */
export function Avatar({ alt, src, size = "md", className, ...rest }: AvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(src) && !imageFailed;
  const { box, text } = AVATAR_SIZE_CLASSES[size];

  return (
    <span
      {...rest}
      role={showImage ? undefined : "img"}
      aria-label={showImage ? undefined : alt}
      className={cx(AVATAR_BASE_CLASSES, box, text, className)}
    >
      {showImage ? (
        <img
          src={src}
          alt={alt}
          className={AVATAR_IMAGE_CLASSES}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span aria-hidden="true">{avatarInitials(alt)}</span>
      )}
    </span>
  );
}
