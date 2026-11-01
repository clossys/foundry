import { studioCopy } from '../lib/studio-copy';
import { headers } from 'next/headers';
import { RECORD_SPECIMEN_THEME_HEADER, RECORD_SPECIMEN_WIDTH_HEADER } from '../../src/server/record-specimens';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { StudioProviders, THEME_INIT_SCRIPT } from '../components/StudioProviders';

export const metadata: Metadata = { title: studioCopy("studio.studio"), description: studioCopy("studio.browse-your-agent-cells"), icons: { icon: '/api/brand/mark.svg' } };
export const dynamic = 'force-dynamic';

/**
 * The consumer's Designer globals (shadcn variables, fonts, base layer) load after
 * Studio's stock component layer, so the consumer's brand is what renders.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const requestHeaders = await headers();
  const theme = requestHeaders.get(RECORD_SPECIMEN_THEME_HEADER);
  const width = Number(requestHeaders.get(RECORD_SPECIMEN_WIDTH_HEADER));
  if ((theme === 'light' || theme === 'dark') && (width === 375 || width === 768 || width === 1280)) {
    return <html lang="en" className={theme === 'dark' ? 'dark' : undefined} data-theme={theme} style={{ colorScheme: theme }}>
      <head><link rel="stylesheet" href="/api/designer/globals.css" precedence="consumer" /></head>
      <body className="bg-background font-sans text-foreground antialiased" style={{ width, maxWidth: '100%' }}>{children}</body>
    </html>;
  }
  return <html lang="en" suppressHydrationWarning>
    <head>
      <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      <link rel="stylesheet" href="/api/designer/globals.css" precedence="consumer" />
    </head>
    <body className="min-h-svh bg-background font-sans text-foreground antialiased"><StudioProviders>{children}</StudioProviders></body>
  </html>;
}
