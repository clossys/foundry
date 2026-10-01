import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteFooter, SiteHeader } from "@clossys/designer/shell/server";
import { MarketingView } from "./MarketingView.js";
import type { MarketingViewProps } from "./MarketingView.js";
import { MarketingView as MarketingViewServer } from "./MarketingView.server.js";

const BASE: MarketingViewProps = {
  brand: "BRAND-SENTINEL",
  heroHeading: "HERO-SENTINEL",
  features: [],
  ctaHeading: "CTA-SENTINEL",
  footerSecondary: <span>FOOTER-SENTINEL</span>,
};

const banner = (html: string) => /^<div[^>]*>(<header\b[\s\S]*?<\/header>)<main/.exec(html)?.[1] ?? "";
const footer = (html: string) => /(<footer\b[\s\S]*<\/footer>)<\/div>$/.exec(html)?.[1] ?? "";

describe.each([
  ["MarketingView", MarketingView],
  ["MarketingView (react-server)", MarketingViewServer],
])("%s header slots", (_name, View) => {
  const view = (props: Partial<MarketingViewProps> = {}) => renderToStaticMarkup(<View {...BASE} {...props} />);

  it("renders headerAction, secondaryAction and nav inside the banner landmark and nowhere else", () => {
    const html = view({
      headerAction: <a href="/contact">HEADER-ACTION-SENTINEL</a>,
      secondaryAction: <a href="/sign-in">SECONDARY-ACTION-SENTINEL</a>,
      nav: <nav aria-label="Primary">NAV-SENTINEL</nav>,
    });
    const header = banner(html);
    for (const sentinel of ["HEADER-ACTION-SENTINEL", "SECONDARY-ACTION-SENTINEL", "NAV-SENTINEL"]) {
      expect(header).toContain(sentinel);
      expect(html.split(sentinel)).toHaveLength(2);
    }
    expect(header.indexOf("SECONDARY-ACTION-SENTINEL")).toBeLessThan(header.indexOf("HEADER-ACTION-SENTINEL"));
  });

  it("renders the same header and footer as a bare SiteHeader and SiteFooter when every slot is omitted", () => {
    const html = view();
    expect(banner(html)).toBe(renderToStaticMarkup(<SiteHeader brand="BRAND-SENTINEL" />));
    expect(footer(html)).toBe(renderToStaticMarkup(<SiteFooter secondary={<span>FOOTER-SENTINEL</span>} />));
  });

  it("passes ground to both the header and the footer, leaving the section bands alone", () => {
    const html = view({ ground: "transparent" });
    expect(banner(html)).toBe(renderToStaticMarkup(<SiteHeader ground="transparent" brand="BRAND-SENTINEL" />));
    expect(footer(html)).toBe(renderToStaticMarkup(<SiteFooter ground="transparent" secondary={<span>FOOTER-SENTINEL</span>} />));
    expect(html.replace(banner(html), "").replace(footer(html), "")).toBe(view().replace(banner(view()), "").replace(footer(view()), ""));
  });
});
