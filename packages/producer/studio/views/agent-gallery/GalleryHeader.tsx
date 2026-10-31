import { Badge, CardDescription, CardHeader, CardTitle, LinkButton } from '@clossys/designer-ui';
import type { GalleryHeaderData } from './types';

/** The gallery title, its leaf count and one jump link per layer section. */
export function GalleryHeader({ header, layers }: { header: GalleryHeaderData; layers: readonly { id: string; label: string }[] }) {
  return <CardHeader>
    <CardTitle role="heading" aria-level={1} className="text-xl">{header.title}</CardTitle>
    <CardDescription>{header.description}</CardDescription>
    {header.notice && <CardDescription><Badge variant="outline">{header.notice}</Badge></CardDescription>}
    <CardDescription className="flex flex-wrap gap-1 pt-2">
      {layers.map(layer => <LinkButton key={layer.id} href={`#${layer.id}`} variant="outline" size="sm">{layer.label}</LinkButton>)}
    </CardDescription>
  </CardHeader>;
}
