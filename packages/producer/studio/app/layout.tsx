import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getThemeInitScript } from '@clossys/designer/theme/server';
import { StudioBrand } from '../components/StudioBrand';
import { StudioSelectionProvider } from '../components/StudioSelection';
import { StudioAppsProvider } from '../components/StudioApps';
import { parseThemeResponse, type StudioTheme } from '../lib/config-client';

export const metadata: Metadata = { title: 'Studio', description: 'Browse your agent cells.' };
export const dynamic = 'force-dynamic';

async function initialTheme(): Promise<StudioTheme | undefined> {
  try {
    const origin = new URL(process.env.CLOSSYS_PRODUCER_ORIGIN ?? '');
    if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Invalid Producer origin');
    const response = await fetch(new URL('/api/config', origin), { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Producer config unavailable');
    return parseThemeResponse(await response.json());
  } catch {
    return undefined;
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = await initialTheme();
  return <html lang="en" data-brand-bound={theme ? '' : undefined} data-theme-hash={theme?.hash} data-theme-state={theme ? 'ready' : 'connecting'} data-studio-state={theme ? 'selection-loading' : 'connecting'} suppressHydrationWarning>
    <head>
      <script dangerouslySetInnerHTML={{ __html: getThemeInitScript() }} />
      <style id="studio-brand-theme" dangerouslySetInnerHTML={{ __html: theme?.css ?? '' }} />
      <style id="studio-selection-style" />
    </head>
    <body className="m-0 font-body"><StudioBrand initialTheme={theme}><StudioSelectionProvider><StudioAppsProvider>{children}</StudioAppsProvider></StudioSelectionProvider></StudioBrand></body>
  </html>;
}
