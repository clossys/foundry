import { Children, isValidElement, type ReactNode } from "react";
import { Icon, type IconSize } from "../components/Icon.js";
import { cx } from "../components/internal/cx.js";
import { ChevronRight } from "../icons/ChevronRight.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";

/*
 * The linked-item anatomy shared by `Item`, `Items`, and `NavGrid`
 * (internal: not exported from the package). It lives beside the blocks rather than in `blocks/internal/`
 * because the `compiled.css` scan skips `internal/`, and these class strings
 * must compile.
 *
 * One `<a>` per item sits on the item's title, so the title is the link's
 * accessible name. The anchor's `::after` is absolutely positioned over the
 * item (the stretched-link pattern): the item's container is `relative
 * isolate`, so a click anywhere on it follows the link and Tab stops once.
 * The keyboard ring is drawn on that `::after`, so it surrounds the whole
 * item. The chevron is the T4 quiet action's: the same `ChevronRight` component,
 * the same `quiet-action` utility (its RTL mirror and its hover nudge, which
 * never runs under reduced motion), visible at rest. A no-break space in an
 * `aria-hidden` span joins it to the title's last word, so it never wraps
 * alone and stays out of the name. Hover underlines the title in its own
 * ink; nothing is transitioned.
 *
 * Nothing between the item container and the anchor may carry a transform,
 * a filter or containment: any of those makes that element the containing
 * block of the `::after`, and the hit area shrinks to it. `font-display`
 * sets `transform: scaleX(--font-display-scale-x)`, so a display-face title
 * that holds the link adds `transform-none` (see `Item`).
 */

/**
 * The shape the hit area and ring take: the plate itself (`plate`), a bare
 * item with a hover plate around it (`plain`), a rule-topped item whose hover
 * plate starts under the rule (`rule`), or a `NavGrid` control tile (`control`).
 */
export type CardLinkFrame = "plate" | "plain" | "rule" | "control";

/** The anchor: inherits the title's ink, no underline at rest, the T4 quiet-action chevron behaviour. */
const ANCHOR_BASE =
  "quiet-action text-inherit outline-none underline decoration-transparent underline-offset-4 hover:decoration-current after:absolute after:z-10";

/** Where the anchor's `::after` (hit area and ring) sits, relative to the item container. */
const HIT_AREA_CLASSES: Record<CardLinkFrame, string> = {
  plate: "after:inset-0 after:rounded-panel",
  plain: "after:-inset-x-sm after:-inset-y-sm tablet:after:-inset-x-md tablet:after:-inset-y-md after:rounded-panel",
  rule: "after:-inset-x-sm after:top-0 after:-bottom-sm tablet:after:-inset-x-md tablet:after:-bottom-md after:rounded-panel",
  control: "after:inset-0 after:rounded-control",
};

/** The keyboard ring on the `::after`: the package-standard outline, in the on-inverse accent on an inverse band. */
const RING_CLASSES: Record<SectionGround, string> = {
  base: "focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent",
  sunken: "focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent",
  inverse: "focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent-on-inverse",
};

/** A bare item's hover plate (`::before`, under the content): the band's other ground, on hover and keyboard focus only. */
const HOVER_PLATE_FILL_CLASSES: Record<SectionGround, string> = {
  base: "before:absolute before:-z-10 before:rounded-panel hover:before:bg-surface-sunken has-focus-visible:before:bg-surface-sunken",
  sunken: "before:absolute before:-z-10 before:rounded-panel hover:before:bg-surface-raised has-focus-visible:before:bg-surface-raised",
  inverse:
    "before:absolute before:-z-10 before:rounded-panel hover:before:bg-surface-inverse-raised has-focus-visible:before:bg-surface-inverse-raised",
};

/** The hover plate takes the hit area's shape; a plate, a tile or a step needs none of its own. */
const HOVER_PLATE_INSET_CLASSES: Record<CardLinkFrame, string | undefined> = {
  plate: undefined,
  plain: "before:-inset-x-sm before:-inset-y-sm tablet:before:-inset-x-md tablet:before:-inset-y-md",
  rule: "before:-inset-x-sm before:top-0 before:-bottom-sm tablet:before:-inset-x-md tablet:before:-bottom-md",
  control: undefined,
};

/** The item container and its hover plate on the matching section ground. */
export function cardLinkContainerClassName(frame: CardLinkFrame, ground: SectionGround): string {
  const inset = HOVER_PLATE_INSET_CLASSES[frame];
  const fill = HOVER_PLATE_FILL_CLASSES[ground];
  return cx("relative isolate", inset === undefined ? undefined : fill, inset);
}

export interface CardLinkTitleProps {
  href: string;
  frame: CardLinkFrame;
  ground: SectionGround;
  /** The chevron's step: `sm` beside body-scale titles, `md` beside a display title. @default "sm" */
  iconSize?: IconSize;
  /** The title text: the link's accessible name. */
  children: ReactNode;
  /** Optional block-specific interaction classes; shared defaults stay unchanged. */
  className?: string;
}

/** The title as the item's one link, with its chevron. Place it inside the title element. */
export function CardLinkTitle({ href, frame, ground, iconSize = "sm", children, className }: CardLinkTitleProps) {
  return (
    <a href={href} data-card-link="" className={cx(ANCHOR_BASE, HIT_AREA_CLASSES[frame], RING_CLASSES[ground], className)}>
      {children}
      <span aria-hidden="true">{" "}</span>
      <Icon glyph={ChevronRight} decorative size={iconSize} className={cx("inline align-middle", SECTION_GROUND_CLASSES[ground].secondary)} />
    </a>
  );
}

const INTERACTIVE_TAGS = new Set(["a", "button", "input", "select", "textarea", "summary", "details", "label", "iframe"]);

function interactiveIn(node: ReactNode, inSvg = false): boolean {
  let found = false;
  Children.forEach(node, (child) => {
    if (found || !isValidElement(child)) return;
    const props = (child.props ?? {}) as Record<string, unknown>;
    const tag = typeof child.type === "string" ? child.type.toLowerCase() : undefined;
    const svg = tag === "svg" || inSvg;
    const resource = svg && (tag === "use" || tag === "image");
    const editable = props.contentEditable === true || (typeof props.contentEditable === "string" && ["", "true", "plaintext-only"].includes(props.contentEditable.toLowerCase()));
    const focusable = (typeof props.tabIndex === "number" && Number.isFinite(props.tabIndex)) || (typeof props.tabIndex === "string" && props.tabIndex.trim() !== "" && Number.isFinite(Number(props.tabIndex)));
    // A passive SVG reference is not a link; authored handlers, focus and editing still create targets.
    if (typeof child.type === "string" && INTERACTIVE_TAGS.has(child.type)) found = true;
    else if ((props.href !== undefined && !resource) || props.onClick !== undefined || props.onPress !== undefined || (resource && (editable || focusable))) found = true;
    else found = interactiveIn(props.children as ReactNode, tag === "foreignobject" ? false : svg);
  });
  return found;
}

/** Private content probe; compatibility callers may choose separate controls instead of a stretched link. */
export function hasInteractiveContent(parts: readonly ReactNode[]): boolean {
  return parts.some((part) => interactiveIn(part));
}

/**
 * Throws a `TypeError` when any part of a linked item holds an interactive
 * element (a link, a button, a field, or an element with `href`, `onClick`
 * or `onPress`): the item is one link, so nothing inside it may be another
 * target. Passive `use` and `image` href references under a literal `<svg>`
 * in the supplied tree are allowed; handlers, focus, editing and interactive
 * descendants still make those resources targets. `<foreignObject>` resets
 * SVG context, and a nested literal `<svg>` restores it. Other SVG href
 * carriers are conservatively refused, even when their references are passive.
 * Reads the React elements as passed: an opaque wrapper does not establish
 * SVG context, and its own rendered output is not inspected. Referenced
 * symbol content is also uninspected; callers must keep it noninteractive.
 */
export function assertNoNestedInteractive(block: string, id: string, parts: readonly ReactNode[]): void {
  if (hasInteractiveContent(parts)) {
    throw new TypeError(`${block}: item "${id}" is linked (href), so it cannot hold another link, button or field; make its content plain text or drop the href.`);
  }
}
