'use client';

import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { StudioFrame } from '../components/StudioFrame';
import { useThemeMode } from '../components/StudioProviders';
import { DESIGNER_STATUS_LABEL, DESIGNER_STATUS_TONE, loadDesignerLeaf, specimenHref, type DesignerLeaf } from '../lib/designer-library';
import { PROOF_PAGE_ID } from '../lib/proof-routes';
import { DesignerDetail } from './designer-detail';
import { GalleryNotice } from './designer-gallery';

type Load = { state: 'loading' } | { state: 'ready'; value: DesignerLeaf } | { state: 'missing' } | { state: 'error'; message: string };
const NO_ACTIONS: never[] = [];

const versionFlags = (row: DesignerLeaf['versions'][number]) => [row.pinned && 'Pinned', row.released && 'Released', row.verified && 'Verified'].filter((flag): flag is string => Boolean(flag));

/** `/designer/<leaf>`: one leaf's specimen, contract, lineage and versions. */
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
  if (load.state === 'missing') notFound();
  const leaf = load.state === 'ready' ? load.value : undefined;
  return <StudioFrame pageId={PROOF_PAGE_ID} actions={NO_ACTIONS} {...(leaf ? { trail: leaf.card.name } : {})}>
    {load.state === 'loading' ? <GalleryNotice state="loading" />
      : load.state === 'error' ? <GalleryNotice state="error" message={load.message} />
      : leaf && <DesignerDetail
        header={{
          name: leaf.card.name, slot: leaf.card.slot, ...(leaf.card.version !== undefined ? { version: leaf.card.version } : {}),
          statusLabel: DESIGNER_STATUS_LABEL[leaf.card.status], statusTone: DESIGNER_STATUS_TONE[leaf.card.status],
          statusDetail: leaf.statusDetail, trail: leaf.trail, galleryHref: '/designer',
        }}
        {...(leaf.card.specimen ? { specimenSrc: specimenHref(leaf.card, resolved, 960)! } : {})}
        contract={{
          ...(leaf.contract.kind ? { kind: leaf.contract.kind } : {}), ...(leaf.contract.root ? { root: leaf.contract.root } : {}),
          inputs: leaf.contract.inputs,
          lists: [
            { label: 'Composes', items: leaf.contract.composes },
            { label: 'Copy keys', items: leaf.contract.copyKeys },
            { label: 'Theme variables', items: leaf.contract.themeVars },
            { label: 'Depends on', items: leaf.contract.dependencies },
          ],
        }}
        lineage={leaf.lineage.map(row => ({ version: row.version, mode: row.mode, parent: row.parent !== undefined ? `v${row.parent}` : '—', source: row.source ?? '—' }))}
        versions={leaf.versions.map(row => ({ version: row.version, createdAt: row.createdAt, reason: row.reason, hash: row.hash.slice(0, 19), flags: versionFlags(row) }))}
      />}
  </StudioFrame>;
}
