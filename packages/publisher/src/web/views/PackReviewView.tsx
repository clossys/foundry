import { useId } from "react";
import type { ReactNode } from "react";
import { Badge, type BadgeVariant } from "@clossys/designer/atoms/server";
import { PageHeader } from "@clossys/designer/blocks/server";
import { SiteFooter, SiteHeader } from "@clossys/designer/shell/server";
import type { SiteHeaderProps } from "@clossys/designer/shell/server";
import { RenderError } from "../../internal/errors.js";
import type { PackReviewExportKind, PackReviewStatus } from "../../pack/review-index.js";
import { BrandGuideView } from "./BrandGuideView.js";
import type { BrandGuideAssetLink, BrandGuideFact, BrandGuideSpecimen } from "./BrandGuideView.js";

/** One forced state of a page: the slug shown, and the same-site address that pins the page to it. */
export interface PackReviewViewState {
  id: string;
  href: string;
}

export interface PackReviewViewPage {
  /** The route, shown as it is, e.g. `/contact`. */
  id: string;
  /** The page's own same-site address. */
  href: string;
  status: PackReviewStatus;
  states: readonly PackReviewViewState[];
}

export interface PackReviewViewExport {
  /** Unique across the exports. */
  id: string;
  kind: PackReviewExportKind;
  /** The output path, shown as plain text; the view makes no link of it. */
  path: string;
  /** A same-site address that serves the export. When present, the kind's name links to it. */
  href?: string;
  status: PackReviewStatus;
  /** The review width in CSS pixels, for an export that is reviewed at one. */
  width?: number;
}

/** A named value, shown as a term and its description. */
export interface PackReviewViewFact {
  name: string;
  value: string;
}

/** The strategy brief, as the host read it from its records. */
export interface PackReviewViewStrategy {
  /** One line naming the record the section was read from. */
  source: string;
  /** The brief's summary. Shown as the none label when omitted. */
  summary?: string;
  /** Context the owner has already given. */
  context: readonly PackReviewViewFact[];
  /** Questions still open for the owner, one list item each. */
  openQuestions: readonly string[];
}

/** The brand kit, rendered by `BrandGuideView` inside the review. */
export interface PackReviewViewBrandKit {
  title: string;
  usage: string;
  /** Each `href` must be a same-site address, as a page's must. */
  assets: readonly BrandGuideAssetLink[];
  colors: readonly BrandGuideFact[];
  type: readonly BrandGuideFact[];
  facts: readonly BrandGuideFact[];
  specimen?: BrandGuideSpecimen;
}

export interface PackReviewViewFaqItem {
  question: string;
  answer: string;
}

/** The voice rules and the reusable copy, as the host read them from its records. */
export interface PackReviewViewVoice {
  rules: readonly PackReviewViewFact[];
  /** Shown as the none label when omitted. */
  tagline?: string;
  /** The pitch at each length, shortest first. */
  pitch: readonly PackReviewViewFact[];
  /** The boilerplate at each length, shortest first. */
  boilerplate: readonly PackReviewViewFact[];
  faq: readonly PackReviewViewFaqItem[];
}

/** Every visible string. The view owns no wording: a host passes approved copy for each. */
export interface PackReviewViewLabels {
  /** The strategy brief section. `empty` is shown when no `strategy` is passed. */
  strategy: { heading: string; empty: string; summary: string; context: string; openQuestions: string };
  /** The brand kit section. `empty` is shown when no `brandKit` is passed; the rest name `BrandGuideView`'s sections. */
  brandKit: { heading: string; empty: string; assets: string; colors: string; type: string; specimen: string; facts: string };
  /** The voice and copy section. `empty` is shown when no `voice` is passed. */
  voice: { heading: string; empty: string; rules: string; tagline: string; pitch: string; boilerplate: string; faq: string };
  pagesHeading: string;
  exportsHeading: string;
  sheetHeading: string;
  /** Shown in place of a list with no entries. */
  none: string;
  /** The words for each iteration badge. */
  statuses: Readonly<Record<PackReviewStatus, string>>;
  /** The words naming each kind of export. */
  kinds: Readonly<Record<PackReviewExportKind, string>>;
  /** Names the review width of an export, e.g. for `600`. */
  exportWidth: (width: number) => string;
  /** The accessible name of one contact-sheet frame. `state` is absent for a page's own address. */
  frameTitle: (frame: { page: string; state?: string; width: number }) => string;
}

export interface PackReviewViewProps {
  /** Persistent site identity, rendered by Designer's `SiteHeader`. Required, as in the other views. */
  brand: ReactNode;
  /** Text-only label naming the surface, shown as `SiteHeader`'s non-interactive badge. Required: this view is never a member-facing page. */
  surfaceLabel: string;
  /** A call to action, rendered in the banner (`SiteHeader`'s `actions`) before the surface badge. Absent from the markup when omitted. */
  headerAction?: ReactNode;
  /** A secondary call to action, rendered in the banner just before `headerAction`. Absent from the markup when omitted. */
  secondaryAction?: ReactNode;
  /** The primary navigation, rendered in the banner beside the brand. Absent from the markup when omitted. */
  nav?: ReactNode;
  /**
   * The plate of the header and footer, passed to both `SiteHeader` and
   * `SiteFooter`.
   * @default "base"
   */
  ground?: import("../internal/viewChromeGround.js").SiteChromeGround;
  heading: ReactNode;
  description: ReactNode;
  /** The strategy brief. When omitted, its section shows `labels.strategy.empty`. */
  strategy?: PackReviewViewStrategy;
  /** The brand kit. When omitted, its section shows `labels.brandKit.empty`. */
  brandKit?: PackReviewViewBrandKit;
  /** The voice rules and reusable copy. When omitted, its section shows `labels.voice.empty`. */
  voice?: PackReviewViewVoice;
  pages: readonly PackReviewViewPage[];
  exports: readonly PackReviewViewExport[];
  labels: PackReviewViewLabels;
  /** Viewport widths of the contact sheet, in CSS pixels. @default [390, 1024, 1440] */
  widths?: readonly number[];
  /** Persistent footer content, rendered by Designer's `SiteFooter`. */
  footerSecondary?: ReactNode;
}

const DEFAULT_WIDTHS: readonly number[] = [390, 1024, 1440];

/** Tall enough to show a page's first screens without a scroll bar of its own in most layouts. */
const FRAME_HEIGHT = 640;

const STATUS_VARIANT: Readonly<Record<PackReviewStatus, BadgeVariant>> = {
  draft: "neutral",
  delegated: "warning",
  approved: "success",
};

/** A same-site address: one leading slash, no second slash, no backslash, no control character. Anything else is refused, not rendered. */
const SAME_SITE_HREF = /^\/(?!\/)[^\\\u0000-\u001f\u007f-\u009f]*$/;

function requireHref(value: unknown, path: string): string {
  if (typeof value !== "string" || !SAME_SITE_HREF.test(value)) {
    throw new RenderError("resolution-failed", `PackReviewView requires ${path} to be a same-site address.`);
  }
  return value;
}

function requireStatus(value: unknown, path: string): PackReviewStatus {
  if (value !== "draft" && value !== "delegated" && value !== "approved") {
    throw new RenderError("resolution-failed", `PackReviewView requires ${path} to be draft, delegated or approved.`);
  }
  return value;
}

function requireWidths(widths: readonly number[]): readonly number[] {
  if (!Array.isArray(widths) || widths.length === 0 || !widths.every((width) => Number.isInteger(width) && width > 0 && width <= 4096)) {
    throw new RenderError("resolution-failed", "PackReviewView requires widths to be positive whole numbers.");
  }
  return widths;
}

function ReviewPart({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-xs">
      <h3 className="text-h3 text-ink-primary">{heading}</h3>
      {children}
    </div>
  );
}

function NoneNotice({ label }: { label: string }) {
  return <p className="text-body-s text-ink-muted">{label}</p>;
}

function FactList({ entries, none }: { entries: readonly PackReviewViewFact[]; none: string }) {
  if (entries.length === 0) return <NoneNotice label={none} />;
  return (
    <dl className="flex flex-col gap-sm text-body-s">
      {entries.map((entry, index) => (
        <div key={`${index}:${entry.name}`} className="flex flex-col gap-xs">
          <dt className="text-ink-secondary">{entry.name}</dt>
          <dd className="text-ink-primary">{entry.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function TextList({ entries, none }: { entries: readonly string[]; none: string }) {
  if (entries.length === 0) return <NoneNotice label={none} />;
  return (
    <ul className="flex flex-col gap-xs ps-lg text-body-s">
      {entries.map((entry, index) => (
        <li key={`${index}:${entry}`}>{entry}</li>
      ))}
    </ul>
  );
}

interface SheetFrame {
  key: string;
  page: string;
  state?: string;
  href: string;
  status: PackReviewStatus;
}

/**
 * The dev-only review index: one page showing the pack's strategy brief, its
 * brand kit (through `BrandGuideView`, embedded, with no lockup markup) and
 * its voice and reusable copy, then a site's pages and their forced states,
 * its exported artifacts, and a contact sheet that renders each page and
 * state in a lazy frame at each width. Each of the first three sections is
 * optional and shows its own empty label when the host passes nothing for
 * it, and a list inside one with no entries shows the none label. Every
 * page, state, frame and export carries an iteration
 * badge (`draft`, `delegated` or `approved`): each page, forced state and
 * contact-sheet frame shows its page's badge, and each export its own.
 *
 * The frame is the other Publisher views': Designer's `SiteHeader` with the
 * surface badge, a `PageHeader`, and `SiteFooter`, with the page held to the
 * form measure (`--ui-width-form-max`). The contact sheet scrolls sideways
 * inside its own section, so the widest frame never widens the page.
 *
 * Server-safe: no client hooks. It reads nothing and fetches nothing; the
 * caller builds the entries (`buildPackReviewIndex`) and the addresses, and
 * the view refuses any address that is not same-site (a brand-kit asset's
 * included), an unknown badge, and a
 * width that is not a positive whole number, naming the position and never
 * the value. Text is rendered as text; no markup from an entry is injected.
 */
export function PackReviewView({
  brand,
  surfaceLabel,
  headerAction,
  secondaryAction,
  nav,
  ground = "base",
  heading,
  description,
  strategy,
  brandKit,
  voice,
  pages,
  exports,
  labels,
  widths = DEFAULT_WIDTHS,
  footerSecondary,
}: PackReviewViewProps) {
  const sheetWidths = requireWidths(widths);
  // One id per section heading, so each section is named by its own h2 through `aria-labelledby`.
  const strategyHeadingId = useId();
  const brandKitHeadingId = useId();
  const voiceHeadingId = useId();
  const pagesHeadingId = useId();
  const exportsHeadingId = useId();
  const sheetHeadingId = useId();

  pages.forEach((page, pageIndex) => {
    requireHref(page.href, `pages[${pageIndex}].href`);
    requireStatus(page.status, `pages[${pageIndex}].status`);
    page.states.forEach((state, stateIndex) => requireHref(state.href, `pages[${pageIndex}].states[${stateIndex}].href`));
  });
  exports.forEach((entry, index) => {
    requireStatus(entry.status, `exports[${index}].status`);
    if (entry.href !== undefined) requireHref(entry.href, `exports[${index}].href`);
  });
  brandKit?.assets.forEach((asset, index) => requireHref(asset.href, `brandKit.assets[${index}].href`));

  const frames: SheetFrame[] = pages.flatMap((page) => [
    { key: page.id, page: page.id, href: page.href, status: page.status },
    ...page.states.map((state) => ({ key: `${page.id}:${state.id}`, page: page.id, state: state.id, href: state.href, status: page.status })),
  ]);

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader
        ground={ground}
        brand={brand}
        nav={nav}
        secondaryAction={secondaryAction}
        actions={headerAction}
        surfaceLabel={surfaceLabel}
      />
      <main
        className="mx-auto flex w-full flex-1 flex-col gap-xl px-lg py-2xl"
        style={{ maxWidth: "var(--ui-width-form-max, none)" }}
      >
        <PageHeader title={heading} description={description} />

        <section className="flex flex-col gap-md" aria-labelledby={strategyHeadingId}>
          <h2 id={strategyHeadingId} className="text-h2 text-ink-primary">
            {labels.strategy.heading}
          </h2>
          {strategy === undefined ? (
            <NoneNotice label={labels.strategy.empty} />
          ) : (
            <>
              <p className="text-body-s text-ink-secondary">{strategy.source}</p>
              <ReviewPart heading={labels.strategy.summary}>
                {strategy.summary === undefined ? <NoneNotice label={labels.none} /> : <p className="text-body">{strategy.summary}</p>}
              </ReviewPart>
              <ReviewPart heading={labels.strategy.context}>
                <FactList entries={strategy.context} none={labels.none} />
              </ReviewPart>
              <ReviewPart heading={labels.strategy.openQuestions}>
                <TextList entries={strategy.openQuestions} none={labels.none} />
              </ReviewPart>
            </>
          )}
        </section>

        <section className="flex flex-col gap-md" aria-labelledby={brandKitHeadingId}>
          <h2 id={brandKitHeadingId} className="text-h2 text-ink-primary">
            {labels.brandKit.heading}
          </h2>
          {brandKit === undefined ? (
            <NoneNotice label={labels.brandKit.empty} />
          ) : (
            <BrandGuideView
              embedded
              title={brandKit.title}
              usage={brandKit.usage}
              assets={brandKit.assets}
              colors={brandKit.colors}
              type={brandKit.type}
              facts={brandKit.facts}
              {...(brandKit.specimen === undefined ? {} : { specimen: brandKit.specimen })}
              emptyLabel={labels.none}
              downloadsLabel={labels.brandKit.assets}
              colorLabel={labels.brandKit.colors}
              typeLabel={labels.brandKit.type}
              specimenLabel={labels.brandKit.specimen}
              factsLabel={labels.brandKit.facts}
            />
          )}
        </section>

        <section className="flex flex-col gap-md" aria-labelledby={voiceHeadingId}>
          <h2 id={voiceHeadingId} className="text-h2 text-ink-primary">
            {labels.voice.heading}
          </h2>
          {voice === undefined ? (
            <NoneNotice label={labels.voice.empty} />
          ) : (
            <>
              <ReviewPart heading={labels.voice.rules}>
                <FactList entries={voice.rules} none={labels.none} />
              </ReviewPart>
              <ReviewPart heading={labels.voice.tagline}>
                {voice.tagline === undefined ? <NoneNotice label={labels.none} /> : <p className="text-body">{voice.tagline}</p>}
              </ReviewPart>
              <ReviewPart heading={labels.voice.pitch}>
                <FactList entries={voice.pitch} none={labels.none} />
              </ReviewPart>
              <ReviewPart heading={labels.voice.boilerplate}>
                <FactList entries={voice.boilerplate} none={labels.none} />
              </ReviewPart>
              <ReviewPart heading={labels.voice.faq}>
                <FactList entries={voice.faq.map((item) => ({ name: item.question, value: item.answer }))} none={labels.none} />
              </ReviewPart>
            </>
          )}
        </section>

        <section className="flex flex-col gap-md" aria-labelledby={pagesHeadingId}>
          <h2 id={pagesHeadingId} className="text-h2 text-ink-primary">
            {labels.pagesHeading}
          </h2>
          {pages.length === 0 ? (
            <p className="text-body-s text-ink-muted">{labels.none}</p>
          ) : (
            <ul className="flex flex-col gap-md">
              {pages.map((page) => (
                <li key={page.id} className="flex flex-col gap-xs">
                  <span className="flex items-center gap-xs text-body">
                    <a href={page.href}>{page.id}</a>
                    <Badge variant={STATUS_VARIANT[page.status]}>{labels.statuses[page.status]}</Badge>
                  </span>
                  {page.states.length > 0 ? (
                    <ul className="flex flex-wrap gap-sm ps-lg text-body-s">
                      {page.states.map((state) => (
                        <li key={state.id} className="flex items-center gap-xs">
                          <a href={state.href}>{state.id}</a>
                          <Badge variant={STATUS_VARIANT[page.status]}>{labels.statuses[page.status]}</Badge>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-md" aria-labelledby={exportsHeadingId}>
          <h2 id={exportsHeadingId} className="text-h2 text-ink-primary">
            {labels.exportsHeading}
          </h2>
          {exports.length === 0 ? (
            <p className="text-body-s text-ink-muted">{labels.none}</p>
          ) : (
            <ul className="flex flex-col gap-sm">
              {exports.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center gap-xs text-body-s">
                  <Badge variant={STATUS_VARIANT[entry.status]}>{labels.statuses[entry.status]}</Badge>
                  <span className="text-ink-primary">
                    {entry.href === undefined ? labels.kinds[entry.kind] : <a href={entry.href}>{labels.kinds[entry.kind]}</a>}
                  </span>
                  {entry.width === undefined ? null : <span className="text-ink-secondary">{labels.exportWidth(entry.width)}</span>}
                  <code className="break-all text-ink-secondary">{entry.path}</code>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-md" aria-labelledby={sheetHeadingId}>
          <h2 id={sheetHeadingId} className="text-h2 text-ink-primary">
            {labels.sheetHeading}
          </h2>
          {frames.length === 0 ? (
            <p className="text-body-s text-ink-muted">{labels.none}</p>
          ) : (
            <div className="flex flex-col gap-xl overflow-x-auto">
              {frames.map((frame) => (
                <div key={frame.key} className="flex flex-col gap-sm">
                  <p className="flex items-center gap-xs text-body-s text-ink-secondary">
                    <span>{frame.page}</span>
                    {frame.state === undefined ? null : (
                      <>
                        <span aria-hidden="true">{"\u00b7"}</span>
                        <span>{frame.state}</span>
                      </>
                    )}
                    <Badge variant={STATUS_VARIANT[frame.status]}>{labels.statuses[frame.status]}</Badge>
                  </p>
                  <div className="flex gap-lg">
                    {sheetWidths.map((width) => (
                      <iframe
                        key={width}
                        src={frame.href}
                        title={labels.frameTitle({ page: frame.page, ...(frame.state === undefined ? {} : { state: frame.state }), width })}
                        width={width}
                        height={FRAME_HEIGHT}
                        loading="lazy"
                        className="shrink-0 border border-line-base"
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
      <SiteFooter ground={ground} secondary={footerSecondary} />
    </div>
  );
}
