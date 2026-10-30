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
/** Confirmed unpublished inventory; this is presentation, never rendered-page evidence. */
export interface ProducerSpecimenUnpublishedPage {
  readonly publication: 'unpublished';
  readonly emitted: false;
  readonly id: string;
  readonly route: string;
  readonly emptyState: {
    readonly title: string;
    readonly description: string;
    readonly command: string;
    readonly context: string;
  };
}
export type ProducerSpecimenPreviewPage = ProducerSpecimenPublishedPage | ProducerSpecimenUnpublishedPage;
export interface ProducerPagePreviewPort<Page extends ProducerSpecimenPreviewPage = ProducerSpecimenPublishedPage> {
  readonly engine: 'producer-emitted-page@1';
  readonly origin: string;
  readonly pages: readonly Page[];
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

/** Supply actual descriptors or confirmed unpublished inventory to the native bound leaf. */
export function producerPagePreview(publication: PublicationResponse, origin: string): ProducerPagePreviewPort | undefined;
export function producerPagePreview(publication: PublicationResponse, origin: string, unpublishedPages: readonly ProducerSpecimenUnpublishedPage[]): ProducerPagePreviewPort<ProducerSpecimenPreviewPage> | undefined;
export function producerPagePreview(publication: PublicationResponse, origin: string, unpublishedPages: readonly ProducerSpecimenUnpublishedPage[] = []): ProducerPagePreviewPort<ProducerSpecimenPreviewPage> | undefined {
  if (!loopbackOrigin(origin) || publication.state === 'error') return undefined;
  const ids = new Set<string>();
  const pages: ProducerSpecimenPreviewPage[] = [];
  for (const page of publication.state === 'ready' ? publication.pages : []) {
    if (!page.id || ids.has(page.id) || !safePreviewUrl(page.previewUrl) || !/^\/(?!\/)/.test(page.route) || /[\\\x00-\x1f?#]/.test(page.route) || typeof page.emitted !== 'boolean') return undefined;
    ids.add(page.id);
    pages.push(Object.freeze({ id: page.id, route: page.route, previewUrl: page.previewUrl, emitted: page.emitted, stage: page.emitted ? 'emitted' : 'not-emitted' }));
  }
  const unpublished = new Map<string, ProducerSpecimenUnpublishedPage>();
  for (const page of unpublishedPages) {
    if (page.publication !== 'unpublished' || page.emitted !== false || !page.id || !/^\/(?!\/)/.test(page.route) || /[\\\x00-\x1f?#]/.test(page.route)
      || !page.emptyState || [page.emptyState.title, page.emptyState.description, page.emptyState.context].some(value => typeof value !== 'string' || !value.trim())
      || page.emptyState.command !== 'clossys publish --target preview') return undefined;
    const actual = pages.find(candidate => candidate.id === page.id);
    if (actual && (actual.emitted || actual.route !== page.route)) return undefined;
    const record: ProducerSpecimenUnpublishedPage = Object.freeze({ publication: 'unpublished', emitted: false, id: page.id, route: page.route, emptyState: Object.freeze({ title: page.emptyState.title, description: page.emptyState.description, command: page.emptyState.command, context: page.emptyState.context }) });
    const prior = unpublished.get(record.id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(record)) return undefined;
    unpublished.set(record.id, record);
  }
  for (const page of unpublished.values()) {
    const existing = pages.findIndex(candidate => candidate.id === page.id);
    if (existing === -1) pages.push(page); else pages[existing] = page;
  }
  if (!pages.length) return undefined;
  return {
    engine: 'producer-emitted-page@1', origin, pages: Object.freeze(pages),
    renderViewport({ page, viewport, interactive, fullSize }) {
      const actual = pages.find(entry => entry.id === page.id);
      if (interactive !== false || typeof fullSize !== 'boolean' || !actual || 'publication' in actual || !actual.emitted || actual.previewUrl !== page.previewUrl || actual.route !== page.route || !viewport.id || !viewport.label || !Number.isSafeInteger(viewport.width) || viewport.width <= 0 || !Number.isSafeInteger(viewport.height) || viewport.height <= 0) return null;
      // CSS zoom preserves the page's native viewport while scaling its occupied size.
      // Designer owns the containing layout; this engine returns only the guarded iframe.
      const scale = fullSize ? 1 : Math.min(1, PUBLISHER_DEVICES.mobile.width / viewport.width);
      return <iframe src={`${origin}${actual.previewUrl}`} title={viewport.label} sandbox="" referrerPolicy="no-referrer" tabIndex={-1} width={viewport.width} height={viewport.height} style={{ border: 0, pointerEvents: 'none', zoom: scale }} />;
    },
  };
}
