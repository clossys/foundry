'use client';

import { useEffect, useMemo, useState } from 'react';
import { notFound } from 'next/navigation';
import { StudioFrame } from '../components/StudioFrame';
import { useThemeMode } from '../components/StudioProviders';
import { designerDetailData, designerNotice, loadDesignerLeaf, type DesignerLeaf } from '../lib/designer-library';
import { PROOF_PAGE_ID } from '../lib/proof-routes';
import { AgentDetail } from './agent-detail';
import { GalleryNotice } from './agent-gallery';
import { OptionsBlock, ViewportSpecimens } from './designer-slots';

type Load = { state: 'loading' } | { state: 'ready'; value: DesignerLeaf } | { state: 'missing' } | { state: 'error'; message: string };
const NO_ACTIONS: never[] = [];

/** `/designer/<leaf>`: one leaf through the shared agent detail template; Designer adds viewport specimens and options as slots. */
export default function DesignerLeafView({ slug }: { slug: string }) {
  const { resolved } = useThemeMode();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    setLoad({ state: 'loading' });
    loadDesignerLeaf(slug, controller.signal).then(value => setLoad(value ? { state: 'ready', value } : { state: 'missing' }), error => {
      if (!controller.signal.aborted) setLoad({ state: 'error', message: error instanceof Error ? error.message : 'The Designer leaf could not load.' });
    });
    return () => controller.abort();
  }, [slug]);
  const data = useMemo(() => load.state === 'ready' ? designerDetailData(load.value, resolved) : undefined, [load, resolved]);
  if (load.state === 'missing') notFound();
  return <StudioFrame pageId={PROOF_PAGE_ID} actions={NO_ACTIONS} {...(data ? { trail: data.header.name } : {})}>
    {load.state === 'loading' ? <GalleryNotice />
      : load.state === 'error' ? <GalleryNotice notice={designerNotice('error', load.message)} />
      : data && <AgentDetail
        header={data.header}
        specimen={{ title: 'Specimen', description: data.specimenDescription }}
        contract={data.contract}
        history={data.history}
        slots={{
          specimen: <ViewportSpecimens name={data.header.name} description={data.specimenDescription} specimens={data.specimens} />,
          ...(data.options.some(row => !row.pinned) ? { afterSpecimen: <OptionsBlock name={data.header.name} rows={data.options} /> } : {}),
        }}
      />}
  </StudioFrame>;
}
