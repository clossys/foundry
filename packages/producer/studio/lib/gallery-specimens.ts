import { contractCopy } from './contract-copy';
/** Gallery previews use the same canonical slot detail projection as the leaf page. */
import type { SlotDetail } from '../../src/server/slot-detail';
import type { ContractInput } from '../sections/studio-contract';
import type { SpecimenInput } from '../sections/studio-specimen';
import { agentGalleryPreview, loadAgentLeaf, type AgentCard, type AgentLeafRecords, type LibraryAgent, type StudioLinks } from './agent-library';
import { loadSlotDetail, slotDetailInputs } from './slot-detail';
import type { PublicationResponse } from './publisher-preview';

export type GalleryLeaf = { source: 'slot'; detail: SlotDetail } | { source: 'legacy'; leaf: AgentLeafRecords };

/** Keep IA order and bounded concurrency. A failed/missing slot never falls through to cells. */
export async function loadGalleryLeaves(agent: LibraryAgent, cards: readonly AgentCard[], signal: AbortSignal): Promise<ReadonlyMap<string, GalleryLeaf | null>> {
  const pending = cards.filter(card => card.records !== 0 && !card.specimenUrl);
  const rows: (GalleryLeaf | null)[] = new Array(pending.length);
  let next = 0;
  const worker = async () => {
    while (next < pending.length && !signal.aborted) {
      const index = next++;
      const card = pending[index]!;
      try {
        const detail = await loadSlotDetail(agent, card.slug, signal);
        if (detail !== undefined) {
          rows[index] = detail ? { source: 'slot', detail } : null;
        } else {
          // Undefined is reserved by loadSlotDetail for the explicit native legacy state.
          const leaf = await loadAgentLeaf(agent, card.slug, signal);
          rows[index] = leaf ? { source: 'legacy', leaf } : null;
        }
      } catch { rows[index] = null; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, pending.length) }, worker));
  return new Map(pending.map((card, index) => [card.id, rows[index] ?? null]));
}

type Viewport = Extract<SpecimenInput, { kind: 'viewports' }>['specimens'][number];
/** A page card frames one view-only viewport, the widest, in the Studio's current theme. */
function cardViewport(rows: readonly Viewport[], theme: 'light' | 'dark'): Viewport[] {
  const widest = [...rows].sort((a, b) => b.viewport - a.viewport)[0];
  if (!widest) return [];
  return [{ viewport: widest.viewport, light: theme === 'dark' && widest.dark ? widest.dark : widest.light, interactive: false }];
}

/** Native rows share the detail's pinned six-view projection; pageUrl serves explicit legacy rows only. */
export function galleryLeafInputs(row: GalleryLeaf, links: StudioLinks, theme: 'light' | 'dark', pageUrl?: string, publication?: PublicationResponse): { specimen: SpecimenInput; contract: ContractInput } {
  if (row.source === 'legacy') return { specimen: agentGalleryPreview(row.leaf, links, pageUrl), contract: { ...row.leaf.contract, copy: contractCopy() } };
  const inputs = slotDetailInputs(row.detail, links, theme, publication);
  const specimen = inputs.specimen as SpecimenInput;
  return {
    specimen: row.detail.agent === 'publisher' && row.detail.kind === 'page' && specimen.kind === 'viewports'
      ? { ...specimen, specimens: cardViewport(specimen.specimens, theme) }
      : specimen,
    contract: inputs.contract as ContractInput,
  };
}
