import { studioCopy } from '../lib/studio-copy';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { StudioProviders, THEME_INIT_SCRIPT } from '../components/StudioProviders';
import { loadStudioSeed } from '../lib/studio-seed';

export const metadata: Metadata = { title: studioCopy("studio.studio"), description: studioCopy("studio.browse-your-agent-cells"), icons: { icon: '/api/brand/favicon.svg', apple: '/api/brand/app-icon.svg' } };
export const dynamic = 'force-dynamic';

/**
 * The consumer's Designer globals (shadcn variables, fonts, base layer) load after
 * Studio's stock component layer, so the consumer's brand is what renders. The body carries no
 * classes: its ground, ink and font come from the Designer base layer (R-DS-ONLY), and the
 * pre-paint theme script is plain text content, not injected HTML.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every route's shared Producer data, so the first paint is the page rather than a loading state.
  const seed = await loadStudioSeed();
  return <html lang="en" suppressHydrationWarning>
    <head>
      <script>{THEME_INIT_SCRIPT}</script>
      <link rel="stylesheet" href="/api/designer/globals.css" precedence="consumer" />
    </head>
    <body><StudioProviders {...(seed ? { seed } : {})}>{children}</StudioProviders></body>
  </html>;
}
