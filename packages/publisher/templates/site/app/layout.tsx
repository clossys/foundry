import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

// Reads brand tokens from clossys/designer/brand.css at build time — the
// repository's own file, never copied into this template. See this
// template's own README, "What every page actually reads."

export const metadata: Metadata = {
  title: {
    default: "Home",
    template: "%s",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
