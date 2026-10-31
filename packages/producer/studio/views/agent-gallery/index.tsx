import { Card, CardContent } from '@clossys/designer-ui';
import { GalleryHeader } from './GalleryHeader';
import { LayerSection } from './LayerSection';
import type { GalleryHeaderData, GalleryLayerData } from './types';

export type { GalleryCardData, GalleryGroupData, GalleryHeaderData, GalleryLayerData, GalleryNoticeData, GalleryTone } from './types';
export { GalleryNotice } from './GalleryNotice';

/** Any agent's gallery: L0-L2 anchored sections in one vertical scroll, L3 leaves as view-only link cards. */
export function AgentGallery({ header, unit, layers }: { header: GalleryHeaderData; unit: readonly [string, string]; layers: readonly GalleryLayerData[] }) {
  return <Card className="m-4 md:m-6">
    <GalleryHeader header={header} layers={layers} />
    <CardContent className="flex flex-col gap-10">
      {layers.map(layer => <LayerSection key={layer.id} layer={layer} unit={unit} />)}
    </CardContent>
  </Card>;
}
