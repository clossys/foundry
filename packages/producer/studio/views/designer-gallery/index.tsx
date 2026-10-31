import { Card, CardContent } from '@clossys/designer-ui';
import { GalleryHeader } from './GalleryHeader';
import { LayerSection } from './LayerSection';
import type { GalleryLayerData } from './types';

export type { GalleryCardData, GalleryGroupData, GalleryLayerData, GalleryTone } from './types';
export { GalleryNotice } from './GalleryNotice';

/** The Designer gallery: L0-L2 anchored sections in one vertical scroll, L3 leaves as view-only link cards. */
export function DesignerGallery({ count, layers }: { count: number; layers: readonly GalleryLayerData[] }) {
  return <Card className="m-4 md:m-6">
    <GalleryHeader count={count} layers={layers} />
    <CardContent className="flex flex-col gap-10">
      {layers.map(layer => <LayerSection key={layer.id} layer={layer} />)}
    </CardContent>
  </Card>;
}
