import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getThemeInitScript } from "@clossys/designer/theme/server";
import { errorCopyIds, requireCopy, siteFrameCopyIds } from "./site-copy";
import { SiteCopyProvider } from "./site-copy-context";
import { createSiteCopyResolver, loadBrandFacts, siteLocale, siteOrigin, siteTarget } from "./site-records";
import "./globals.css";

// Reads brand tokens from clossys/designer/brand.css at build time — the
// repository's own file, never copied into this template. See this
// template's own README, "What every page actually reads."

// The brand name is the default title; every page sets its own. `metadataBase`
// is the site's origin from `NEXT_PUBLIC_SITE_URL`, which has no fallback.
export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(siteOrigin()),
    title: {
      default: loadBrandFacts().brandLabel,
      template: "%s",
    },
  };
}

// `data-brand-bound` is set in server-rendered markup so the brand file's
// `:root[data-brand-bound]` rules apply and Designer's unbranded badge stays
// off. The theme init script runs before first paint and sets the theme
// attributes on <html> itself, so React is told to expect that difference.
// `lang` is the copy registry's locale, the language every word on the page is
// in. The error boundary's copy and its frame's brand facts are resolved here,
// on the server, and provided to the client boundary below.
export default function RootLayout({ children }: { children: ReactNode }) {
  const errorCopy = requireCopy(createSiteCopyResolver(siteTarget()), [...errorCopyIds(), ...siteFrameCopyIds()]);
  const { brandLabel, entity } = loadBrandFacts();
  return (
    <html lang={siteLocale()} data-brand-bound suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: getThemeInitScript() }} />
      </head>
      <body>
        <SiteCopyProvider copy={errorCopy} facts={{ brandLabel, entity }}>
          {children}
        </SiteCopyProvider>
      </body>
    </html>
  );
}
