'use client';

import { useEffect, useMemo, useState } from 'react';
import { StudioFrame } from '../components/StudioFrame';
import { useThemeMode } from '../components/StudioProviders';
import { DESIGNER_STATUS_LABEL, DESIGNER_STATUS_TONE, designerLeafHref, loadDesignerGallery, specimenHref, type DesignerGallery as GalleryRecords } from '../lib/designer-library';
import { PROOF_PAGE_ID } from '../lib/proof-routes';
import { DesignerGallery, GalleryNotice, type GalleryLayerData } from './designer-gallery';

type Load = { state: 'loading' } | { state: 'ready'; value: GalleryRecords } | { state: 'error'; message: string };

const NO_ACTIONS: never[] = [];

/** Records -> display data: L0 sections open a layer; L1/L2 sections become its groups. */
function galleryLayers(records: GalleryRecords, theme: 'light' | 'dark'): GalleryLayerData[] {
  const layers: { id: string; label: string; groups: GalleryLayerData['groups'][number][] }[] = [];
  for (const section of records.sections) {
    if (section.level === 0) { layers.push({ id: section.id, label: section.label, groups: [] }); continue; }
    if (!layers.length) layers.push({ id: `${section.id}-layer`, label: section.label, groups: [] });
    layers.at(-1)!.groups.push({
      id: section.id, label: section.label, level: section.level,
      cards: section.cards.map(card => ({
        key: card.slot, name: card.name, ...(card.version !== undefined ? { version: card.version } : {}),
        statusLabel: DESIGNER_STATUS_LABEL[card.status], statusTone: DESIGNER_STATUS_TONE[card.status],
        href: designerLeafHref(card.slug),
        ...(card.specimen ? { specimenSrc: specimenHref(card, theme, 480)! } : {}),
      })),
    });
  }
  return layers.filter(layer => layer.groups.length);
}

/** `/designer`: the view-only gallery of the Designer record store. */
export default function DesignerView() {
  const { resolved } = useThemeMode();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    loadDesignerGallery(controller.signal).then(value => setLoad({ state: 'ready', value }), error => {
      if (!controller.signal.aborted) setLoad({ state: 'error', message: error instanceof Error ? error.message : 'The Designer library could not load.' });
    });
    return () => controller.abort();
  }, []);
  const layers = useMemo(() => load.state === 'ready' ? galleryLayers(load.value, resolved) : [], [load, resolved]);
  return <StudioFrame pageId={PROOF_PAGE_ID} actions={NO_ACTIONS}>
    {load.state === 'loading' ? <GalleryNotice state="loading" />
      : load.state === 'error' ? <GalleryNotice state="error" message={load.message} />
      : load.value.state === 'missing' || !layers.length ? <GalleryNotice state="missing" />
      : <DesignerGallery count={load.value.count} layers={layers} />}
  </StudioFrame>;
}
