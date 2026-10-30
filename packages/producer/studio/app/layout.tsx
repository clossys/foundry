import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { StudioProviders, THEME_INIT_SCRIPT } from '../components/StudioProviders';

export const metadata: Metadata = { title: 'Studio', description: 'Browse your agent cells.' };
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en" suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} /></head>
    <body className="min-h-svh bg-background font-sans text-foreground antialiased"><StudioProviders>{children}</StudioProviders></body>
  </html>;
}
