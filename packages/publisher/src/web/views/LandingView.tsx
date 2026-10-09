import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Icon, mergeUiClasses } from "@clossys/designer/atoms/server";
import {
  ContentSection,
  Faq,
  FeatureGrid,
  Hero,
  MediaFigure,
  OrderedStepSequence,
  SECTION_GROUND_CLASSES,
  SectionFrame,
  StatusList,
} from "@clossys/designer/blocks/server";
import type { HeroAlign, SectionMeasure } from "@clossys/designer/blocks/server";
import { ChevronDown } from "@clossys/designer/icons";
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
 * The closing call to action: one band, one action, centred, on the
 * `inverse` ground (fixed by the view, like the light band above it).
 */
export interface LandingViewCallToAction {
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
  callToAction?: LandingViewCallToAction;
  /**
   * Decoration behind the hero block (an image, a video, a scene). Rendered
   * `aria-hidden` and inert to the pointer, over the hero section's own
   * ground, which shows until the backdrop paints. Absent when omitted: the
   * hero section's ground is the backdrop.
   */
  backdrop?: ReactNode;
  /** Where the header band sits. @default "overlay" */
  header?: LandingViewHeader;
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
   * short of the fold so the next band shows, and mark the hero's foot with a
   * chevron cue (decorative, `aria-hidden`). @default true
   */
  peek?: boolean;
  /**
   * `"main"` (default) renders the root as the page's `main` landmark. Pass
   * `"none"` when the frame already owns `main`.
   */
  landmark?: SectionedViewLandmark;
  /** Resolves hero `media.assetId`, as for `SectionedView`. */
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

/** The first screen under an overlay header: the whole viewport, or short of it by the peek. */
const HERO_FILL = {
  full: "100dvh",
  peek: "calc(100dvh - var(--spacing-5xl, 6rem))",
} as const;

/** Vertical rhythm of every body band after the hero: 64px, 96px from `tablet-lg`. */
const BAND_CLASS = "py-4xl tablet-lg:py-5xl";

/** The closing call to action stands apart: one step above a body band at every width (96px, 128px from `tablet-lg`). */
const CALL_TO_ACTION_BAND_CLASS = "py-5xl tablet-lg:py-6xl";

/** Section kinds whose header group and module the bands compose through `ContentSection`. */
const ANATOMY_KINDS: ReadonlySet<string> = new Set(["hero", "feature-grid", "faq", "ordered-step-sequence", "status-list", "content-section"]);

/**
 * Blocks for the bands, each one section anatomy: Designer `ContentSection`
 * holds the section's eyebrow, heading and description (and a hero's
 * actions) as its header group, then the section's content as a module
 * rendered without a heading region of its own, then whatever `afterSection`
 * places there. A hero in a band is a header group with its media as the
 * module, never a second display heading. A `content-section` is already
 * that anatomy: it renders as itself, leaving its ground to the band.
 */
function bandBlocks(afterSection: Readonly<Record<string, ReactNode>>): SectionedViewBlockSet {
  const after = (id: string) => afterSection[id] ?? null;
  return {
    ...sectionedViewBlocks,
    Hero: ({ id, eyebrow, heading, description, actions, media, ground }) => (
      <ContentSection id={id} eyebrow={eyebrow} heading={heading} description={description} actions={actions} ground={ground}>
        {media ? (
          <MediaFigure framed={false} ground={ground}>
            {media}
          </MediaFigure>
        ) : null}
        {after(id)}
      </ContentSection>
    ),
    FeatureGrid: ({ id, eyebrow, heading, description, headingLevel, ground, items }) => (
      <ContentSection id={id} eyebrow={eyebrow} heading={heading} description={description} headingLevel={headingLevel} ground={ground}>
        <FeatureGrid items={items} headingLevel={headingLevel} ground={ground} />
        {after(id)}
      </ContentSection>
    ),
    Faq: ({ id, eyebrow, heading, description, headingLevel, ground, items }) => (
      <ContentSection id={id} eyebrow={eyebrow} heading={heading} description={description} headingLevel={headingLevel} ground={ground}>
        <Faq items={items} headingLevel={headingLevel} ground={ground} />
        {after(id)}
      </ContentSection>
    ),
    OrderedStepSequence: ({ id, eyebrow, heading, description, headingLevel, ground, items }) => (
      <ContentSection id={id} eyebrow={eyebrow} heading={heading} description={description} headingLevel={headingLevel} ground={ground}>
        <OrderedStepSequence items={items} headingLevel={headingLevel} ground={ground} />
        {after(id)}
      </ContentSection>
    ),
    StatusList: ({ id, eyebrow, heading, description, headingLevel, ground, labels, groups, items, legendLabel }) => (
      <ContentSection id={id} eyebrow={eyebrow} heading={heading} description={description} headingLevel={headingLevel} ground={ground}>
        <StatusList labels={labels} legendLabel={legendLabel} headingLevel={headingLevel} ground={ground} {...(groups ? { groups } : { items: items ?? [] })} />
        {after(id)}
      </ContentSection>
    ),
    ContentSection: ({ section, actions }) => <sectionedViewBlocks.ContentSection section={section} actions={actions} after={after(section.id)} />,
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
 * start-aligned header group held to the prose measure, then its content as
 * modules (the section's block without a heading region of its own, then
 * anything placed `afterSection`), one spacing step apart. Sections render
 * through the same validated mapping as `SectionedView`. The hero block is
 * Designer `Hero` (`align`, default centred) on the hero section's ground,
 * with an optional `backdrop`, and its document actions render as Designer
 * primary buttons (`buttonLinkClassName("primary", "lg")`); the call to
 * action is a centred `ContentSection` at `<h2>` with one action. Both copy
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
 * With a call to action, the closing pair is fixed by the view: the last
 * band on `base`, the call to action on `inverse`. The view draws no rule
 * at either edge of the call to action: the ground change from the band
 * above is its top seam, and the frame footer's own top hairline (Designer
 * `SiteFooter`) is its foot, so the seam is drawn once. Sections that omit
 * `ground` under the `"view"` rhythm alternate `base`/`sunken` counting
 * upward from the last band, so no page needs an even or odd section count;
 * an explicit ground still wins. Each band carries `data-landing-ground`.
 * The view paints the `base` ground itself (on its root), so a band on
 * `base` never shows a page or document background through it.
 *
 * What it guarantees: one `<h1>` (the hero section's); a backdrop and cue
 * that are inert to assistive technology and to the pointer; an `afterSection`
 * key that matches no section is refused; copy only from the documents and
 * props. What it does not do: check the contrast of the hero copy over a
 * backdrop (the backdrop's contract, Designer's `checkBackdropContract`), or
 * restyle the call to action's action.
 */
export function LandingView({
  document,
  trailing = [],
  afterSection = {},
  callToAction,
  backdrop,
  header = "overlay",
  align = "center",
  measure = "wide",
  peek = true,
  landmark = "main",
  resolveAssetId,
  prefersReducedMotion,
  className,
  style,
  ...rest
}: LandingViewProps) {
  const options = { resolveAssetId, prefersReducedMotion };
  const heroOptions = { ...options, heroActions: "button" as const };
  for (const entry of [document, ...trailing]) {
    try {
      assertRenderableSectionedViewDocument(entry);
    } catch (error) {
      throw new RenderError("resolution-failed", `LandingView refused an invalid resolved document: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const heroSection = document.sections[0];
  if (heroSection === undefined || heroSection.kind !== "hero") {
    throw new RenderError("resolution-failed", "LandingView refused an invalid resolved document: the first section must be a hero section.");
  }
  const plan = planLandingViewGrounds(document, trailing, { callToAction: callToAction === undefined ? undefined : { id: callToAction.id } });
  const [grounded, ...groundedTrailing] = applyLandingViewGrounds(plan, [document, ...trailing]);
  const hasBackdrop = backdrop !== undefined && backdrop !== null && backdrop !== false;
  const [heroBlock] = renderSectionedViewSections(
    { id: document.id, resolutions: document.resolutions, sections: [heroSection] },
    {
      ...sectionedViewBlocks,
      Hero: (props) => <Hero {...props} headingLevel={1} align={align} className={hasBackdrop ? "bg-transparent" : undefined} />,
    },
    heroOptions,
    "LandingView",
  );
  const blocks = bandBlocks(afterSection);
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

  const hasContent = bands.length > 0 || callToAction !== undefined;
  const fills = header === "overlay";
  const peeks = fills && peek && hasContent;
  const heroInk = SECTION_GROUND_CLASSES[heroSection.ground];
  const Root = landmark === "main" ? "main" : "div";

  return (
    <Root {...rest} data-landing-view="" className={mergeUiClasses("flex flex-col bg-surface-base", className)} style={style}>
      <SectionFrame
        data-landing-hero=""
        data-landing-ground={heroSection.ground}
        ground={heroSection.ground}
        measure={measure}
        className={mergeUiClasses("relative isolate", HERO_PADDING[header])}
        style={fills ? { minHeight: peeks ? HERO_FILL.peek : HERO_FILL.full } : undefined}
      >
        {hasBackdrop ? (
          <div aria-hidden="true" data-landing-backdrop="" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
            {backdrop}
          </div>
        ) : null}
        {heroBlock?.node}
        {afterSection[heroSection.id] ?? null}
        {peeks ? (
          <span aria-hidden="true" data-landing-cue="" className={mergeUiClasses("pointer-events-none absolute inset-x-0 bottom-xl flex justify-center", heroInk.muted)}>
            <Icon glyph={ChevronDown} decorative size="lg" />
          </span>
        ) : null}
      </SectionFrame>
      {bands.map(({ section, node }) => (
        <SectionFrame key={section.id} data-landing-ground={section.ground} ground={section.ground} measure={measure} className={BAND_CLASS}>
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
      {callToAction ? <CallToActionBand {...callToAction} measure={measure} /> : null}
    </Root>
  );
}

/**
 * The closing band: a centred Designer `ContentSection` at `<h2>` (the
 * `section` emphasis every band heading takes), with its one action, on the
 * inverse ground, at the band rhythm. It draws no edge rule of its own: a
 * frame footer on the same ground carries the one hairline between them.
 */
function CallToActionBand({ id, eyebrow, heading, description, action, measure }: LandingViewCallToAction & { measure: SectionMeasure }) {
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
      <ContentSection headingLevel={2} align="center" ground={ground} eyebrow={eyebrow} heading={heading} description={description} actions={action} />
    </SectionFrame>
  );
}
