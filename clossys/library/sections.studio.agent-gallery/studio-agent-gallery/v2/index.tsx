import { CardContent } from '@clossys/designer-ui';
import { GalleryHeader } from './GalleryHeader';
import { LayerSection } from './LayerSection';
import type { AgentGalleryInput } from './types';

export type { AgentGalleryInput, GalleryCardData, GalleryGroupData, GalleryHeaderData, GalleryLayerData, GalleryTone } from './types';

/**
 * `sections.studio.agent-gallery`: any agent's gallery. L0-L2 anchored sections in one vertical
 * scroll, L3 leaves as a vertical list of view-only link cards, one per row. The page body is the
 * frame's column, so the section adds no outer card. Reads only its `gallery` input.
 */
export default function AgentGallerySection({ gallery }: { gallery: AgentGalleryInput }) {
  return <section data-studio-section="agent-gallery" aria-label={gallery.header.title}>
    <GalleryHeader header={gallery.header} />
    <CardContent className="flex flex-col gap-10 px-0 pt-6">
      {gallery.layers.map(layer => <LayerSection key={layer.id} layer={layer} unit={gallery.unit} />)}
    </CardContent>
  </section>;
}
