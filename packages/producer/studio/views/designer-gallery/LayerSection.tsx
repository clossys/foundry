import { CardContent, CardTitle, Separator } from '@clossys/designer-ui';
import { GroupSection } from './GroupSection';
import type { GalleryLayerData } from './types';

/** An L0 layer: an anchored heading over its groups. */
export function LayerSection({ layer }: { layer: GalleryLayerData }) {
  const heading = `${layer.id}-heading`;
  return <section id={layer.id} aria-labelledby={heading}>
    <CardTitle id={heading} role="heading" aria-level={2} className="text-lg">{layer.label}</CardTitle>
    <Separator className="my-3" />
    <CardContent className="flex flex-col gap-8 px-0">
      {layer.groups.map(group => <GroupSection key={group.id} group={group} />)}
    </CardContent>
  </section>;
}
