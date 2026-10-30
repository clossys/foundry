import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { StudioProviders, THEME_INIT_SCRIPT } from '../components/StudioProviders';

export const metadata: Metadata = { title: 'Studio', description: 'Browse your agent cells.', icons: { icon: '/api/brand/mark.svg' } };
export const dynamic = 'force-dynamic';

/**
 * The consumer's Designer globals (shadcn variables, fonts, base layer) load after
 * Studio's stock component layer, so the consumer's brand is what renders.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en" suppressHydrationWarning>
    <head>
      <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      <link rel="stylesheet" href="/api/designer/globals.css" precedence="consumer" />
    </head>
    <body className="min-h-svh bg-background font-sans text-foreground antialiased"><StudioProviders>{children}</StudioProviders></body>
  </html>;
}
