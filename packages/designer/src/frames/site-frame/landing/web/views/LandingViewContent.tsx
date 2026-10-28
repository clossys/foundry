import { Children, isValidElement, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { Icon, iconButtonLinkClassName, mergeUiClasses } from "@clossys/designer/components/server";
import {
  ContentSection,
  FeatureGrid,
  Hero,
  MediaFigure,
  OrderedStepSequence,
  SectionFrame,
  StatusList,
} from "@clossys/designer/blocks/server";
import type { HeroAlign, SectionMeasure } from "@clossys/designer/blocks/server";
import { ChevronDown } from "@clossys/designer/icons";
import { resolveRoleActionEmphasis } from "../../core/sectioned-view.js";
import { renderRoleActions, type LandingViewAction } from "./SectionedViewActions.js";
import { isSanctionedHref } from "../../internal/href.js";
import type { ResolvedSectionedViewDocument } from "../../core/sectioned-view.js";
import { RenderError } from "../../internal/errors.js";
import type { AssetResolver } from "../types.js";
import { sectionedViewBlocks } from "./SectionedViewBlocks.server.js";
import { applyLandingViewGrounds, LANDING_VIEW_CALL_TO_ACTION_GROUND, planLandingViewGrounds } from "./landingViewGrounds.js";
import { assertRenderableSectionedViewDocument, renderSectionedViewSections, type SectionedViewBlockSet, type SectionedViewLandmark } from "./SectionedViewContent.js";

/**
 * Where the page's header band sits relative to the hero block.
 *
 * - `"overlay"` (default): the header floats over the top of the hero block,
 *   whose ground (and `backdrop`) runs up under it. The hero block fills the
 *   first screen and keeps the band's height clear above its copy.
 * - `"reserved"`: the frame holds the header in flow above this view; the
 *   hero block is as tall as its copy plus the section rhythm.
 */
export type LandingViewHeader = "overlay" | "reserved";

/**
 * The closing call to action: one band with resolved actions or an action slot, centred, on the
 * `inverse` ground (fixed by the view, like the light band above it).
 */
export interface LandingViewCallToAction {
  /** Reuse the opening hero's heading and description where own copy is undefined. */
  copy?: "hero";
  /** Fragment id for the band, so a page can link to it. */
  id?: string;
  /** A short line above the heading. */
  eyebrow?: ReactNode;
  /** The band's heading, rendered as an `<h2>`. */
  heading: ReactNode;
  /** One line of supporting copy under the heading. */
  description?: ReactNode;
  /**
   * The one action. A slot: pass a button-styled link (the page's primary
   * call to action, Designer `buttonLinkClassName("primary", "lg")`, the
   * same treatment the view gives the hero's actions). It is not restyled
   * here.
   */
  action: ReactNode;
  /** Resolved closing copy, with at most one inline link after its text. */
  footnote?: { text: ReactNode; link?: { label: ReactNode; href: string } };
}

export interface LandingViewProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /**
   * The page's resolved document (`resolveSectionedViewDocument`). Its first
   * section must be a `hero`: the hero block, and the page's only `<h1>`.
   * The sections after it follow as bands.
   */
  document: ResolvedSectionedViewDocument;
  /**
   * Further resolved documents after `document`, rendered as more bands (for
   * example a shared FAQ). A hero section in one of them renders as an `<h2>`.
   */
  trailing?: readonly ResolvedSectionedViewDocument[];
  /**
   * Content placed after a section, inside that section's band and column,
   * keyed by section id (an illustration, a screenshot, an embed). An id that
   * names no rendered section is refused rather than dropped.
   */
  afterSection?: Readonly<Record<string, ReactNode>>;
  /** The closing call to action, rendered last as its own band. */
  callToAction?:
    | (LandingViewCallToAction & { actions?: never })
    | (Omit<LandingViewCallToAction, "heading" | "copy"> & { copy: "hero"; heading?: ReactNode; actions?: never })
    | (Omit<LandingViewCallToAction, "action"> & { action?: never; actions: readonly LandingViewAction[] })
    | (Omit<LandingViewCallToAction, "action" | "heading" | "copy"> & { copy: "hero"; heading?: ReactNode; action?: never; actions: readonly LandingViewAction[] });
  /**
   * Decoration behind the hero block (an image, a video, a scene). Rendered
   * `aria-hidden` and inert to the pointer, over the hero section's own
   * ground, which shows until the backdrop paints. Absent when omitted: the
   * hero section's ground is the backdrop.
   */
  backdrop?: ReactNode;
  /** Where the header band sits. @default "overlay" */
  header?: LandingViewHeader;
  /** A lone filling hero may flex into its frame instead of sizing against the viewport. @default "viewport" */
  fit?: "viewport" | "frame";
  /** How the hero copy lines up. @default "center" */
  align?: HeroAlign;
  /**
   * The page's one content column, Designer `SectionFrame`'s measure: every
   * band's content, the hero copy and the call to action sit in the same
   * centred column; grounds stay full-bleed. @default "wide"
   */
  measure?: SectionMeasure;
  /**
   * With `header="overlay"` and content after the hero: stop the hero block
   * short of the fold so the next band shows, and mark the hero's foot with
   * a scroll cue: a round chevron link (`data-landing-cue`, Designer
   * `iconButtonLinkClassName`) fixed to the bottom of the browser window,
   * that jumps to the first band (or to the call to action's `id` when no
   * band follows) and fades out as the page scrolls. No cue renders without
   * a target. @default true
   */
  peek?: boolean;
  /**
   * The scroll cue's accessible name (`aria-label`); pass the page's own
   * localized words. Must not be blank when the cue renders.
   * @default "Scroll to next section"
   */
  cueLabel?: string;
  /**
   * `"main"` (default) renders the root as the page's `main` landmark. Pass
   * `"none"` when the frame already owns `main`.
   */
  landmark?: SectionedViewLandmark;
  /** Resolves hero and canonical content `media.assetId`, as for `SectionedView`. */
  resolveAssetId?: AssetResolver;
  /** When `true`, applies each video asset's `reducedMotion` policy. */
  prefersReducedMotion?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** The hero block's vertical room: under an overlay header it keeps the band clear; reserved, section rhythm only. */
const HERO_PADDING: Record<LandingViewHeader, string> = {
  overlay: "flex flex-col justify-center py-5xl",
  reserved: "flex flex-col justify-center py-4xl",
};

/** Compact heroes clear the overlay header with existing spacing tokens. */
const HERO_PADDING_COMPACT: Record<LandingViewHeader, string> = {
  overlay: "flex flex-col pt-6xl pb-3xl tablet-lg:pb-4xl",
  reserved: "flex flex-col py-3xl tablet-lg:py-4xl",
};

/** The first screen under an overlay header: the whole viewport, or short of it by the peek. */
const HERO_FILL = {
  full: "100dvh",
  peek: "calc(100dvh - var(--spacing-5xl, 6rem))",
} as const;

/** Vertical rhythm of every body band after the hero: 64px, 96px from `tablet-lg`. */
const BAND_CLASS = "py-4xl tablet-lg:py-5xl";

/**
 * A legacy band's section element sits one band padding below its top edge,
 * so its fragment jump takes the same margin: the band's top edge lands at
 * the frame's `scroll-padding-top` (the foot of a sticky header) rather than
 * the section's heading. Matches `BAND_CLASS`'s top padding at every width.
 */
const BAND_ANCHOR_CLASS = "scroll-mt-4xl tablet-lg:scroll-mt-5xl";

/**
 * The scroll cue's place: a zero-height rail between the hero and the first
 * band, stacked one layer above the bands (`--ui-z-sticky`, below the
 * frame's sticky header). It is the cue's fallback anchor: where the engine
 * lacks scroll-driven animations the cue sits centred on the rail's top edge,
 * the edge between the two grounds, and scrolls away with the page.
 */
const CUE_RAIL_CLASS = "relative z-[var(--ui-z-sticky,10)] h-0";

/**
 * The cue itself (Designer `scroll-cue`): fixed to the bottom of the browser
 * window and centred, clear of the safe-area inset by one `xl` step, so it
 * does not slide with the page. It fades out over the first three tap targets
 * of scrolling and is then hidden, out of the tab order and inert. Without
 * scroll-driven animations it falls back to the rail's top edge. Under
 * `prefers-reduced-motion: no-preference`, a smooth page scroll while the
 * page holds the cue.
 */
const CUE_CLASS = "scroll-cue motion-safe:[html:has(&)]:scroll-smooth";

/** The closing call to action stands apart: one step above a body band at every width (96px, 128px from `tablet-lg`). */
const CALL_TO_ACTION_BAND_CLASS = "py-5xl tablet-lg:py-6xl";

/** Section kinds whose header group and block the bands compose through `ContentSection`. */
const ANATOMY_KINDS: ReadonlySet<string> = new Set(["hero", "feature-grid", "faq", "ordered-step-sequence", "status-list", "content-section"]);

/**
 * Blocks for the bands, each one section anatomy: Designer `ContentSection`
 * holds the section's eyebrow, heading and description (and a hero's
 * actions) as its header group, then the section's content as a block
 * rendered without a heading region of its own, then whatever `afterSection`
 * places there. A hero in a band is a header group with its media as the
 * block, never a second display heading. A `content-section` is already
 * that anatomy: it renders as itself, leaving its ground to the band.
 */
function bandBlocks(afterSection: Readonly<Record<string, ReactNode>>, canonicalContentSection: SectionedViewBlockSet["ContentSection"]): SectionedViewBlockSet {
  const after = (id: string) => afterSection[id] ?? null;
  return {
    ...sectionedViewBlocks,
    Hero: ({ id, eyebrow, heading, description, actions, media, ground }) => (
      <ContentSection id={id} eyebrow={eyebrow} heading={heading} description={description} actions={actions} ground={ground} className={BAND_ANCHOR_CLASS}>
        {media ? (
          <MediaFigure framed={false} ground={ground}>
            {media}
          </MediaFigure>
        ) : null}
        {after(id)}
      </ContentSection>
    ),
    FeatureGrid: ({ id, eyebrow, heading, description, headingLevel, ground, items }) => (
      <ContentSection id={id} eyebrow={eyebrow} heading={heading} description={description} headingLevel={headingLevel} ground={ground} className={BAND_ANCHOR_CLASS}>
        <FeatureGrid items={items} headingLevel={headingLevel} ground={ground} />
        {after(id)}
      </ContentSection>
    ),
    OrderedStepSequence: ({ id, eyebrow, heading, description, headingLevel, ground, items }) => (
      <ContentSection id={id} eyebrow={eyebrow} heading={heading} description={description} headingLevel={headingLevel} ground={ground} className={BAND_ANCHOR_CLASS}>
        <OrderedStepSequence items={items} headingLevel={headingLevel} ground={ground} />
        {after(id)}
      </ContentSection>
    ),
    StatusList: ({ id, eyebrow, heading, description, headingLevel, ground, labels, groups, items, legendLabel }) => (
      <ContentSection id={id} eyebrow={eyebrow} heading={heading} description={description} headingLevel={headingLevel} ground={ground} className={BAND_ANCHOR_CLASS}>
        <StatusList labels={labels} legendLabel={legendLabel} headingLevel={headingLevel} ground={ground} {...(groups ? { groups } : { items: items ?? [] })} />
        {after(id)}
      </ContentSection>
    ),
    ContentSection: ({ section, actions, publishedKind, resolveAssetId, prefersReducedMotion }) => {
      const Content = canonicalContentSection;
      return <Content section={section} actions={actions} resolveAssetId={resolveAssetId} prefersReducedMotion={prefersReducedMotion} after={after(section.id)} className={publishedKind === undefined ? "scroll-mt-0" : BAND_ANCHOR_CLASS} />;
    },
  };
}

/**
 * A long-form page: a hero block, then the document's sections as full-bleed
 * bands, then an optional closing call to action. Chrome-free: the frame owns
 * the header, footer and skip link; this view renders page content only.
 *
 * Composition, all from Designer: every band is a `SectionFrame` on its
 * section's ground with the same `measure`, so the hero copy, each section,
 * anything placed `afterSection` and the call to action share one centred
 * column while grounds run full-bleed. Every band has one anatomy, Designer
 * `ContentSection`: the section's eyebrow, heading and description as a
 * start-aligned header group held to the prose measure, then its content
 * (the section's block without a heading region of its own, then
 * anything placed `afterSection`), one spacing step apart. Sections render
 * through the same validated mapping as `SectionedView`. The hero block is
 * Designer `Hero` (`align`, default centred) on the hero section's ground,
 * with an optional `backdrop`, and its document actions use the ground-aware
 * primary, outline and quiet ladder; the call to
 * action is a centred `ContentSection` at `<h2>` with its own actions. Both copy
 * blocks are Designer `SectionIntro`: the hero at the `display` emphasis
 * (the page's one `<h1>`), the close at the `section` emphasis like every
 * other band's heading, held to the same prose measure.
 *
 * Rhythm: the hero block fills the first screen under an overlay header
 * (`py-5xl`); every body band after it is `py-4xl`, `py-5xl` from
 * `tablet-lg`; the call to action sits one step above that at every width
 * (`py-5xl`, `py-6xl` from `tablet-lg`).
 *
 * Grounds (`planLandingViewGrounds`): the hero keeps its section's ground.
 * The last automatic body band defaults to `base`; a final legacy band
 * before a call to action is forced to `base`, while canonical explicit
 * `inverse` remains an anchor. The call to action is on `inverse`.
 * The view draws no rule
 * at either edge of the call to action: the ground change from the band
 * above is its top seam, and the frame footer's own top hairline (Designer
 * `SiteFooter`) is its foot, so the seam is drawn once. Sections that omit
 * canonical `ground`, or legacy `ground` under the `"view"` rhythm, take
 * `sunken` above `base`, and `base` above `sunken` or `inverse`, counting
 * upward from the last body band;
 * an explicit ground still wins. Each band carries `data-landing-ground`.
 * The view paints the `base` ground itself (on its root), so a band on
 * `base` never shows a page or document background through it.
 *
 * Scroll cue (with `peek`): a real link to the first band (a plain fragment
 * `<a>`, native scrolling, no client script), drawn as Designer's round
 * icon link on the target band's ground (the band peeks above the fold),
 * fixed to the bottom of the browser window, centred, so it does not slide
 * with the page. Its accessible name is `cueLabel`. It fades out over the
 * first three tap targets (132px) of scrolling and is then hidden and out
 * of the tab order (Designer `scroll-cue`). An engine without scroll-driven
 * animations instead centres it on the hero's bottom edge, where it scrolls
 * away with the page. The page scrolls smoothly to the band only under
 * `prefers-reduced-motion: no-preference`. Legacy sections compensate for
 * their outer band padding with the same scroll margin. Canonical frame
 * targets begin at the band edge and use zero margin. Consumers can set
 * `scroll-padding-top` on their scroll container to reserve a sticky header.
 *
 * What it guarantees: one `<h1>` (the hero section's); a backdrop that is
 * inert to assistive technology and to the pointer; a cue only when it has
 * a target, with a non-blank name; an `afterSection` key that matches no
 * section is refused; copy only from the documents and props, apart from
 * the cue's default name. What it does not do: check the contrast of the hero copy over a
 * backdrop (the backdrop's contract, Designer's `checkBackdropContract`), or
 * restyle the call to action's action.
 */
export function createLandingView(canonicalContentSection: SectionedViewBlockSet["ContentSection"]) {
return function LandingView({
  document,
  trailing = [],
  afterSection = {},
  callToAction,
  backdrop,
  header = "overlay",
  fit = "viewport",
  align = "center",
  measure = "wide",
  peek = true,
  cueLabel = "Scroll to next section",
  landmark = "main",
  resolveAssetId,
  prefersReducedMotion,
  className,
  style,
  ...rest
}: LandingViewProps) {
  if (callToAction?.copy !== undefined && callToAction.copy !== "hero") {
    throw new RenderError("resolution-failed", "LandingView refused callToAction.copy: the supported copy option is hero.");
  }
  if (callToAction !== undefined) assertCloseActions(callToAction);
  const options = { resolveAssetId, prefersReducedMotion };
  const heroOptions = { ...options, heroActions: "button" as const, heroActionsCentered: align === "center" };
  for (const entry of [document, ...trailing]) {
    try {
      assertRenderableSectionedViewDocument(entry);
    } catch (error) {
      throw new RenderError("resolution-failed", `LandingView refused an invalid resolved document: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const heroSection = document.sections[0];
  if (heroSection === undefined || heroSection.kind !== "hero") {
    throw new RenderError(callToAction?.copy === "hero" ? "missing-hero-copy" : "resolution-failed", "LandingView refused an invalid resolved document: the first section must be a hero section.");
  }
  const close = callToAction?.copy === "hero"
    ? {
      ...callToAction,
      heading: callToAction.heading === undefined ? heroSection.heading : callToAction.heading,
      description: callToAction.description === undefined ? heroSection.description : callToAction.description,
    }
    : callToAction;
  const plan = planLandingViewGrounds(document, trailing, { callToAction: callToAction === undefined ? undefined : { id: callToAction.id } });
  const [grounded, ...groundedTrailing] = applyLandingViewGrounds(plan, [document, ...trailing]);
  const hasBackdrop = backdrop !== undefined && backdrop !== null && backdrop !== false;
  const [heroBlock] = renderSectionedViewSections(
    { id: document.id, resolutions: document.resolutions, sections: [heroSection] },
    {
      ...sectionedViewBlocks,
      Hero: (props) => <Hero {...props} headingLevel={1} align={align} data-landing-action-pair={heroSection.actions?.length === 2 ? "" : undefined} className={hasBackdrop ? "bg-transparent" : undefined} />,
    },
    heroOptions,
    "LandingView",
  );
  const blocks = bandBlocks(afterSection, canonicalContentSection);
  const bands = [
    ...renderSectionedViewSections(grounded, blocks, options, "LandingView").slice(1),
    ...groundedTrailing.flatMap((trailingDocument) => renderSectionedViewSections(trailingDocument, blocks, options, "LandingView")),
  ];

  const ids = new Set<string>([heroSection.id]);
  for (const { section } of bands) {
    if (ids.has(section.id)) throw new RenderError("resolution-failed", `LandingView refused section ${section.id}: an earlier document already rendered that id.`);
    ids.add(section.id);
  }
  for (const key of Object.keys(afterSection)) {
    if (!ids.has(key)) throw new RenderError("resolution-failed", `LandingView refused afterSection.${key}: no rendered section has that id.`);
  }

  const compact = heroSection.size === "compact";
  const hasContent = bands.length > 0 || callToAction !== undefined;
  const fills = !compact && header === "overlay";
  const fitsFrame = fills && fit === "frame" && !hasContent;
  const peeks = fills && peek && hasContent;
  const firstBand = bands[0]?.section;
  const cue = !peeks
    ? undefined
    : firstBand !== undefined
      ? { target: firstBand.id, ground: firstBand.ground }
      : callToAction?.id !== undefined
        ? { target: callToAction.id, ground: LANDING_VIEW_CALL_TO_ACTION_GROUND }
        : undefined;
  if (cue !== undefined && cueLabel.trim() === "") {
    throw new RenderError("resolution-failed", "LandingView refused cueLabel: the scroll cue needs a non-blank accessible name.");
  }
  const Root = landmark === "main" ? "main" : "div";

  return (
    <Root {...rest} data-landing-view="" className={mergeUiClasses("flex flex-col bg-surface-base", fitsFrame ? "flex-1" : undefined, className)} style={style}>
      {heroSection.actions?.length === 2 || close?.actions?.length === 2 ? <style data-landing-action-pair-style="">{LANDING_ACTION_PAIR_CSS}</style> : null}
      <SectionFrame
        data-landing-hero=""
        {...(compact ? { "data-hero-size": "compact" } : {})}
        data-landing-ground={heroSection.ground}
        ground={heroSection.ground}
        measure={measure}
        className={mergeUiClasses("relative isolate", (compact ? HERO_PADDING_COMPACT : HERO_PADDING)[header], fitsFrame ? "flex-1" : undefined, fills && !fitsFrame && !peeks ? "min-h-dvh" : undefined)}
        style={fills && !fitsFrame && peeks ? { minHeight: HERO_FILL.peek } : undefined}
      >
        {hasBackdrop ? (
          <div aria-hidden="true" data-landing-backdrop="" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
            {backdrop}
          </div>
        ) : null}
        {heroBlock?.node}
        {afterSection[heroSection.id] ?? null}
      </SectionFrame>
      {cue ? (
        <div data-landing-cue-rail="" className={CUE_RAIL_CLASS}>
          <a href={`#${cue.target}`} aria-label={cueLabel} data-landing-cue="" className={`${iconButtonLinkClassName(cue.ground === "inverse" ? "inverse" : "base")} ${CUE_CLASS}`}>
            <Icon glyph={ChevronDown} decorative size="md" />
          </a>
        </div>
      ) : null}
      {bands.map(({ section, node }) => (
        <SectionFrame key={section.id} data-landing-ground={section.ground} ground={section.ground} measure={measure} className={section.kind === "content-section" || section.kind === "status-list" ? "py-0" : BAND_CLASS}>
          {ANATOMY_KINDS.has(section.kind) ? (
            node
          ) : (
            <ContentSection ground={section.ground}>
              {node}
              {afterSection[section.id] ?? null}
            </ContentSection>
          )}
        </SectionFrame>
      ))}
      {close ? <CallToActionBand {...close} measure={measure} /> : null}
    </Root>
  );
};
}


/** Stretch the actual intro flex item so mobile pair widths inherit the prose column. */
const LANDING_ACTION_PAIR_CSS = "[data-landing-view] [data-landing-action-pair] > [data-section-intro] > [data-section-intro-actions] { align-self: stretch; }";

/**
 * The closing band: a centred Designer `ContentSection` at `<h2>` (the
 * `section` emphasis every band heading takes), with its own actions, on the
 * inverse ground, at the band rhythm. It draws no edge rule of its own: a
 * frame footer on the same ground carries the one hairline between them.
 */
function CallToActionBand({ id, eyebrow, heading, description, action, actions, footnote, measure }: NonNullable<LandingViewProps["callToAction"]> & { measure: SectionMeasure }) {
  const ground = LANDING_VIEW_CALL_TO_ACTION_GROUND;
  return (
    <SectionFrame
      id={id}
      data-landing-call-to-action=""
      data-landing-ground={ground}
      ground={ground}
      measure={measure}
      className={CALL_TO_ACTION_BAND_CLASS}
    >
      <ContentSection data-landing-action-pair={actions?.length === 2 ? "" : undefined} headingLevel={2} align="center" ground={ground} eyebrow={eyebrow} heading={heading} description={description} actions={actions === undefined ? action : renderRoleActions(actions, ground, true, "lg")} footnote={renderCloseFootnote(footnote)} />
    </SectionFrame>
  );
}


/** Resolved note text followed by its optional inline link. */
function renderCloseFootnote(note: LandingViewCallToAction["footnote"]): ReactNode {
  if (note === undefined) return undefined;
  return <>{note.text}{note.link === undefined ? null : <> <a href={note.link.href} className="text-inherit underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">{note.link.label}</a></>}</>;
}

/** The view accepts resolved action copy while refusing invalid list structure and targets. */
function assertCloseActions(close: NonNullable<LandingViewProps["callToAction"]>): void {
  const refuse = (detail: string): never => { throw new RenderError("resolution-failed", `LandingView refused callToAction: ${detail}.`); };
  const copy = (value: ReactNode): boolean => {
    let visible = false;
    let valid = true;
    try {
      Children.forEach(value, node => {
        if (typeof node === "string") visible ||= node.trim().length > 0;
        else if (typeof node === "number" || typeof node === "bigint" || isValidElement(node)) visible = true;
        else if (node !== null && node !== undefined && typeof node !== "boolean") valid = false;
      });
    } catch {
      return false;
    }
    return valid && visible;
  };
  if (close.actions !== undefined) {
    if (Object.hasOwn(close, "action")) refuse("action and actions are mutually exclusive");
    if (!Array.isArray(close.actions) || close.actions.length < 1 || close.actions.length > 2) refuse("actions must hold one or two resolved actions");
    const ids = new Set<string>();
    let primaries = 0;
    for (let index = 0; index < close.actions.length; index += 1) {
      const action = close.actions[index]!;
      if (action === null || typeof action !== "object" || Array.isArray(action) || Object.keys(action).some(key => !["id", "label", "href", "emphasis"].includes(key))) refuse("each action must have only id, label, href and optional emphasis");
      if (typeof action?.id !== "string" || action.id.trim() === "" || ids.has(action.id) || !copy(action.label) || !isSanctionedHref(action.href)) refuse("each action needs a unique id, resolved label and sanctioned href");
      ids.add(action.id);
      if (action.emphasis !== undefined && !["primary", "secondary", "quiet"].includes(action.emphasis)) refuse("action emphasis must be primary, secondary or quiet");
      if (resolveRoleActionEmphasis(action.emphasis, index) === "primary") primaries += 1;
    }
    if (primaries > 1 || close.actions.length === 1 && primaries !== 1) refuse("keep at most one effective primary and make a lone action primary");
  } else if (!Object.hasOwn(close, "action")) refuse("the close requires its own action or actions");
  if (close.footnote !== undefined) {
    const note = close.footnote;
    if (note === null || typeof note !== "object" || Object.keys(note).some(key => !["text", "link"].includes(key)) || !copy(note.text)) refuse("footnote needs resolved text and an optional link");
    if (note.link !== undefined && (note.link === null || typeof note.link !== "object" || Object.keys(note.link).some(key => !["label", "href"].includes(key)) || !copy(note.link.label) || !isSanctionedHref(note.link.href))) refuse("footnote link needs resolved label and sanctioned href");
  }
}
