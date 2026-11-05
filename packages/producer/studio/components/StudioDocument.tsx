import type { ReactNode } from 'react';
import copyRegistry from '../generated/studio-copy.json';

/**
 * The publication's one document element: `<html>` in the Writer registry's locale around a head
 * and a body. The installed root layout (through the assembly's `PublishedDocument`) and the
 * installed `global-error` state (which replaces the root layout) both render it, so the document
 * is written once and no state draws its own.
 */
export function StudioDocument({ head, children }: { head?: ReactNode; children: ReactNode }) {
  return <html lang={copyRegistry.locale} suppressHydrationWarning>
    <head>{head}</head>
    <body>{children}</body>
  </html>;
}
