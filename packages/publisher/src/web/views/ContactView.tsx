import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { CopyRef, CopyResolver } from "@clossys/writer";
import { Card, mergeUiClasses } from "@clossys/designer/components/server";
import { PageHeader } from "@clossys/designer/blocks/server";
import { SiteFooter, SiteHeader } from "@clossys/designer/shell/server";
import type { SiteFooterLegalProps } from "@clossys/designer/shell/server";
import { siteHeaderPresentation, type SiteChromeGround } from "../internal/viewChromeGround.js";
import { RenderError } from "../../internal/errors.js";
import type { ContactResult } from "../contact/types.js";
import { ContactForm } from "./ContactForm.js";
import type { ContactFormCopy, ContactFormDevPreview, ContactFormTopic, ContactFormValues } from "./ContactForm.js";

export interface ContactViewCopy extends ContactFormCopy {
  /** The page's only h1; independent of the chosen topic. */
  heading: CopyRef;
  description: CopyRef;
}
export type ContactViewTopic = ContactFormTopic;
/** Legacy dynamic honeypot contract. ContactForm infers a caller's literal key. */
export type ContactViewValues = ContactFormValues<string>;
export type ContactViewDevPreview = ContactFormDevPreview;

/** @deprecated Use SiteFrame with CaptureView and ContactForm. */
export interface ContactViewProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "onSubmit"> {
  /** Persistent site identity, rendered in the page banner. A slot: consumers typically pass a `Brandmark`. */
  brand: ReactNode;
  /** The site's call to action, rendered in the banner (`SiteHeader`'s `actions`). Absent from the markup when omitted. */
  headerAction?: ReactNode;
  /** A secondary call to action, rendered in the banner just before `headerAction`. Absent from the markup when omitted. */
  secondaryAction?: ReactNode;
  /** The primary navigation, rendered in the banner beside the brand. Absent from the markup when omitted. */
  nav?: ReactNode;
  /**
   * The plate of the header and footer, passed to both `SiteHeader` and
   * `SiteFooter`.
   * @default "transparent"
   */
  ground?: SiteChromeGround;
  /** The legal row, passed straight to `SiteFooter.Legal`. Every visible word in it comes from these props. */
  legal: SiteFooterLegalProps;
  /** The approved-copy resolver used for every string in `copy` and in `topics`. */
  resolveCopyId: CopyResolver;
  copy: ContactViewCopy;
  /** The topics on offer, at least one, with unique kebab-case ids. */
  topics: readonly ContactViewTopic[];
  /** A topic id to preselect. An id that is not in `topics` is ignored. */
  initialTopic?: string;
  /**
   * Name of the hidden honeypot field. Match the handler's `honeypotField`.
   * @default "website"
   */
  honeypotField?: string;
  /** Sends the form. Its `ContactResult` decides what the view shows next; a rejection is read as `unavailable`. */
  onSubmit: (values: ContactViewValues) => Promise<ContactResult>;
  /**
   * Pins the view to one state and makes it inert: submitting never calls
   * `onSubmit`. For a review page only. A production page must not pass it,
   * and the view never reads the URL or the environment to choose one itself.
   * A value outside `ContactViewDevPreview` throws.
   */
  devPreview?: ContactViewDevPreview;
  style?: CSSProperties;
}

function resolveCopy(ref: CopyRef | undefined, path: string, resolver: CopyResolver): string {
  const resolution = ref === undefined || ref === null ? undefined : resolver(ref);
  if (resolution === undefined || typeof resolution.text !== "string" || resolution.text.trim().length === 0) {
    throw new RenderError("resolution-failed", `ContactView could not resolve copy at ${path}.`);
  }
  return resolution.text;
}

/**
 * Compatibility contact page composing ContactForm with its legacy chrome.
 * @deprecated Use SiteFrame > CaptureView > ContactForm. Do not nest this
 * compatibility page inside another frame.
 */
export function ContactView({
  brand, headerAction, secondaryAction, nav, ground = "transparent", legal,
  resolveCopyId, copy, topics, initialTopic, honeypotField = "website", onSubmit, devPreview,
  className, style, ...rest
}: ContactViewProps) {
  const heading = resolveCopy(copy.heading, "copy.heading", resolveCopyId);
  const description = resolveCopy(copy.description, "copy.description", resolveCopyId);
  return (
    <ContactViewFrame {...rest} className={className} style={style} brand={brand} headerAction={headerAction} secondaryAction={secondaryAction} nav={nav} ground={ground} legal={legal}>
      <PageHeader title={heading} description={description} />
      <Card>
        <ContactForm resolveCopyId={resolveCopyId} copy={copy} topics={topics} initialTopic={initialTopic} honeypotField={honeypotField} onSubmit={onSubmit} devPreview={devPreview} />
      </Card>
    </ContactViewFrame>
  );
}

/** Legacy frame retained for ContactView callers; new pages use SiteFrame. */
function ContactViewFrame({ brand, headerAction, secondaryAction, nav, ground, legal, className, style, children, ...rest }:
  Pick<ContactViewProps, "brand" | "headerAction" | "secondaryAction" | "nav" | "ground" | "legal"> & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={mergeUiClasses("flex min-h-dvh flex-col", className)} style={style}>
      <SiteHeader {...siteHeaderPresentation(ground)} brand={brand} nav={nav} actions={<>{secondaryAction}{headerAction}</>} />
      <main className="mx-auto flex w-full flex-1 flex-col gap-xl px-lg py-2xl max-w-[var(--ui-width-prose-max,none)]">
        {children}
      </main>
      <SiteFooter ground={ground} secondary={<SiteFooter.Legal {...legal} />} />
    </div>
  );
}
