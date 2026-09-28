/**
 * Compile-time proof that `SiteFooterLegalProps` (`../SiteFooter.tsx`) is
 * closed: the component owns the copyright format, order and layout, so a
 * consumer can vary none of it and cannot add a disclaimer. There is no
 * `children`, no `className`/`style`, no HTML-attribute pass-through and no
 * disclaimer member.
 *
 * This is a `*.check.tsx` file, not part of `SiteFooter.test.tsx`, because
 * `tsc` excludes `*.test.tsx` and a `@ts-expect-error` there asserts nothing
 * (see `shell-contract.check.tsx` for the full reasoning and the gate that
 * enforces it). `SiteFooter.test.tsx` covers the runtime half: a stray
 * `children` or `disclaimer` forced through a cast is never rendered.
 */
import { SiteFooter, type SiteFooterLegalProps } from "../SiteFooter.js";

const links = [{ label: "Privacy", href: "/privacy" }] as const;

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** The exact accepted prop names; adding any member makes this fail to compile. */
export const legalPropKeysAreClosed: Equal<keyof SiteFooterLegalProps, "entity" | "links" | "linksLabel"> = true;

export const legalAcceptsTheDocumentedProps = (
  <SiteFooter.Legal entity="Acme Studio" links={links} linksLabel="Legal links" />
);

// @ts-expect-error — `children` is not accepted: the copyright line is component-owned.
export const legalRejectsChildren = <SiteFooter.Legal entity="Acme Studio" links={links}>extra</SiteFooter.Legal>;

// @ts-expect-error — no disclaimer member: a consumer cannot add legal copy to the row.
export const legalRejectsDisclaimer = <SiteFooter.Legal entity="Acme Studio" links={links} disclaimer="x" />;

// @ts-expect-error — no `className`: the responsive layout is component-owned.
export const legalRejectsClassName = <SiteFooter.Legal entity="Acme Studio" links={links} className="x" />;

// @ts-expect-error — no `style`: the responsive layout is component-owned.
export const legalRejectsStyle = <SiteFooter.Legal entity="Acme Studio" links={links} style={{}} />;

// @ts-expect-error — no HTML attribute pass-through.
export const legalRejectsHtmlAttributes = <SiteFooter.Legal entity="Acme Studio" links={links} id="x" />;

// @ts-expect-error — `entity` is required.
export const legalRequiresEntity = <SiteFooter.Legal links={links} />;
