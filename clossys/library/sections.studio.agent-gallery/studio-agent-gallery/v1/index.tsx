import { Card, CardContent } from '@clossys/designer-ui';
import { GalleryHeader } from './GalleryHeader';
import { LayerSection } from './LayerSection';
import type { AgentGalleryInput } from './types';

export type { AgentGalleryInput, GalleryCardData, GalleryGroupData, GalleryHeaderData, GalleryLayerData, GalleryTone } from './types';

/**
 * `sections.studio.agent-gallery`: any agent's gallery. L0-L2 anchored sections in one vertical
 * scroll, L3 leaves as view-only link cards. Reads only its `gallery` input.
 */
export default function AgentGallerySection({ gallery }: { gallery: AgentGalleryInput }) {
  return <Card className="m-4 md:m-6" data-studio-section="agent-gallery">
    <GalleryHeader header={gallery.header} layers={gallery.layers} />
    <CardContent className="flex flex-col gap-10">
      {gallery.layers.map(layer => <LayerSection key={layer.id} layer={layer} unit={gallery.unit} />)}
    </CardContent>
  </Card>;
}
