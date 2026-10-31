'use client';

import { useEffect, useMemo, useState } from 'react';
import { StudioFrame } from '../components/StudioFrame';
import { useThemeMode } from '../components/StudioProviders';
import { DESIGNER_UNIT, designerGalleryHeader, designerGalleryLayers, designerNotice, loadDesignerGallery, type DesignerGallery as GalleryRecords } from '../lib/designer-library';
import { PROOF_PAGE_ID } from '../lib/proof-routes';
import { AgentGallery, GalleryNotice } from './agent-gallery';

type Load = { state: 'loading' } | { state: 'ready'; value: GalleryRecords } | { state: 'error'; message: string };

const NO_ACTIONS: never[] = [];

/** `/designer`: the view-only gallery of the Designer record store, through the shared agent gallery template. */
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
  const layers = useMemo(() => load.state === 'ready' ? designerGalleryLayers(load.value, resolved) : [], [load, resolved]);
  return <StudioFrame pageId={PROOF_PAGE_ID} actions={NO_ACTIONS}>
    {load.state === 'loading' ? <GalleryNotice />
      : load.state === 'error' ? <GalleryNotice notice={designerNotice('error', load.message)} />
      : load.value.state === 'missing' || !layers.length ? <GalleryNotice notice={designerNotice('missing')} />
      : <AgentGallery header={designerGalleryHeader(load.value)} unit={DESIGNER_UNIT} layers={layers} />}
  </StudioFrame>;
}
