import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getThemeInitScript } from "@clossys/designer/theme/server";
import { errorCopyIds, requireCopy } from "./site-copy";
import { SiteCopyProvider } from "./site-copy-context";
import { createSiteCopyResolver, loadBrandFacts, siteTarget } from "./site-records";
import "./globals.css";

// Reads brand tokens from clossys/designer/brand.css at build time — the
// repository's own file, never copied into this template. See this
// template's own README, "What every page actually reads."

// The brand name is the default title; every page sets its own.
export function generateMetadata(): Metadata {
  return {
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
// The error boundary's copy is resolved here, on the server, and provided to
// the client boundary below.
export default function RootLayout({ children }: { children: ReactNode }) {
  const errorCopy = requireCopy(createSiteCopyResolver(siteTarget()), errorCopyIds());
  return (
    <html lang="en" data-brand-bound suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: getThemeInitScript() }} />
      </head>
      <body>
        <SiteCopyProvider copy={errorCopy}>{children}</SiteCopyProvider>
      </body>
    </html>
  );
}
