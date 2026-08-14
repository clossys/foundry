import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Avatar } from "../atoms/Avatar.js";
import { cx } from "../atoms/internal/cx.js";

interface TestimonialBaseProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /** The quoted words themselves. */
  quote: ReactNode;
  /** Who said it. A separate field from `attributorRole` so a consumer can style each part independently — never one blob of text. */
  attributorName: ReactNode;
  /** The attributor's role and/or affiliation ("VP Engineering, Acme"). Optional: a well-known attributor may need no further context. */
  attributorRole?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export type TestimonialProps = TestimonialBaseProps &
  (
    | {
        /** Omit both entirely for a testimonial with no avatar image. */
        avatarSrc?: undefined;
        avatarAlt?: undefined;
      }
    | {
        /** Image URL for the attributor's picture. */
        avatarSrc: string;
        /**
         * Accessible name for the avatar image — REQUIRED whenever
         * `avatarSrc` is supplied, the exact same "no way to supply an
         * image without also supplying its alt text" enforcement `Chip`'s
         * own `removeLabel`/`onRemove` pairing already establishes in this
         * package (see that component's own doc comment): this prop is
         * only optional in the branch of `TestimonialProps` where
         * `avatarSrc` is absent too. Rendered via this package's own
         * `Avatar` atom, which independently requires `alt` at ITS own
         * type level — belt and suspenders, not redundant, since `Avatar`
         * enforces the contract for anyone composing it directly while
         * this union enforces it for anyone composing `Testimonial`.
         */
        avatarAlt: string;
      }
  );

/**
 * A single testimonial: a quote, and who said it — `attributorName` and
 * `attributorRole` are always separate props, never concatenated into one
 * string, so a consumer can style the name and role/affiliation
 * differently (weight, colour, size) without parsing them back apart from
 * a blob of text. Three regions that differ in kind (the quote, the
 * attribution, and an optional avatar), and a page can hold two
 * `Testimonial`s (a pair of quotes side by side, or a longer wall of them),
 * which is what makes this a block rather than a view (this package's
 * README, "Placement rules", test 3).
 *
 * **Renders a real `<figure>`/`<blockquote>`/`<figcaption>` triple** — the
 * native HTML elements built for exactly this: a quotation (`blockquote`)
 * with its own self-contained attribution (`figcaption`, inside the
 * `figure` that groups them). `quote` uses this package's own
 * `--text-blockquote` size token (22px by default) rather than the plain
 * `--text-body` scale `PageHeader`'s description reads — a testimonial's
 * quote is typically the most visually prominent text on the section, the
 * same "size communicates hierarchy" reasoning `Hero`'s
 * `--text-display-l` heading and `PageHeader`'s `--text-h1` title apply at
 * their own layer.
 *
 * **The avatar is optional and, when present, required to carry real alt
 * text at the type level** — see `TestimonialProps`' own discriminated
 * union. Composed from this package's own `Avatar` atom (blocks may import
 * atoms) rather than a bare `<img>`, so the initials fallback and
 * image-load-failure handling `Avatar` already implements come for free.
 */
export function Testimonial({
  quote,
  attributorName,
  attributorRole,
  avatarSrc,
  avatarAlt,
  className,
  style,
  ...rest
}: TestimonialProps) {
  return (
    <figure {...rest} className={cx("flex flex-col gap-md", className)} style={style}>
      <blockquote className="text-blockquote font-display text-ink-primary">{quote}</blockquote>
      <figcaption className="flex items-center gap-sm">
        {avatarAlt ? <Avatar alt={avatarAlt} src={avatarSrc} /> : null}
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
