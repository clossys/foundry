import type { ReactNode } from 'react';
import { PUBLISHER_DEVICES, safePreviewUrl, type PublicationResponse } from './publisher-preview';

/** Structural native port from Designer's specimen-content-ports contract. */
export interface ProducerSpecimenPublishedPage {
  readonly id: string;
  readonly route: string;
  readonly previewUrl: string;
  readonly emitted: boolean;
  readonly stage: string;
}
export interface ProducerPagePreviewPort {
  readonly engine: 'producer-emitted-page@1';
  readonly origin: string;
  readonly pages: readonly ProducerSpecimenPublishedPage[];
  renderViewport(input: {
    readonly page: ProducerSpecimenPublishedPage;
    readonly viewport: { readonly id: string; readonly label: string; readonly width: number; readonly height: number };
    readonly interactive: false;
    readonly fullSize: boolean;
  }): ReactNode;
}

function loopbackOrigin(origin: string): boolean {
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/.test(origin)) return false;
  try { return new URL(origin).origin === origin; } catch { return false; }
}

/** Supply only actual publication descriptors to Designer's emitted-page renderer. */
export function producerPagePreview(publication: PublicationResponse, origin: string): ProducerPagePreviewPort | undefined {
  if (!loopbackOrigin(origin) || publication.state !== 'ready' || !publication.pages.length) return undefined;
  const ids = new Set<string>();
  const pages: ProducerSpecimenPublishedPage[] = [];
  for (const page of publication.pages) {
    if (!page.id || ids.has(page.id) || !safePreviewUrl(page.previewUrl) || !/^\/(?!\/)/.test(page.route) || /[\\\x00-\x1f?#]/.test(page.route) || typeof page.emitted !== 'boolean') return undefined;
    ids.add(page.id);
    pages.push(Object.freeze({ id: page.id, route: page.route, previewUrl: page.previewUrl, emitted: page.emitted, stage: page.emitted ? 'emitted' : 'not-emitted' }));
  }
  return {
    engine: 'producer-emitted-page@1', origin, pages: Object.freeze(pages),
    renderViewport({ page, viewport, interactive, fullSize }) {
      const actual = pages.find(entry => entry.id === page.id);
      if (interactive !== false || typeof fullSize !== 'boolean' || !actual?.emitted || actual.previewUrl !== page.previewUrl || actual.route !== page.route || !viewport.id || !viewport.label || !Number.isSafeInteger(viewport.width) || viewport.width <= 0 || !Number.isSafeInteger(viewport.height) || viewport.height <= 0) return null;
      // CSS zoom preserves the page's native viewport while scaling its occupied size.
      // Designer owns the containing layout; this engine returns only the guarded iframe.
      const scale = fullSize ? 1 : Math.min(1, PUBLISHER_DEVICES.mobile.width / viewport.width);
      return <iframe src={`${origin}${actual.previewUrl}`} title={viewport.label} sandbox="" referrerPolicy="no-referrer" tabIndex={-1} aria-hidden="true" width={viewport.width} height={viewport.height} style={{ border: 0, pointerEvents: 'none', zoom: scale }} />;
    },
  };
}
