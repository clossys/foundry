import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getThemeInitScript } from '@clossys/designer/theme/server';
import { defaultStudioTheme } from '../../src/server/theme-default';
import { StudioBrand } from '../components/StudioBrand';
import './globals.css';

export const metadata: Metadata = { title: 'Studio · Clossys', description: 'Browse your agent cells.' };

export default function RootLayout({ children }: { children: ReactNode }) {
  const theme = defaultStudioTheme();
  return <html lang="en" data-brand-bound="" data-theme-hash={theme.hash} suppressHydrationWarning>
    <head>
      <script dangerouslySetInnerHTML={{ __html: getThemeInitScript() }} />
      <style id="studio-brand-theme" dangerouslySetInnerHTML={{ __html: theme.css }} />
    </head>
    <body className="m-0 font-body bg-surface-base text-ink-primary"><StudioBrand>{children}</StudioBrand></body>
  </html>;
}
