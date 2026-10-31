import { CardDescription, CardHeader, CardTitle, LinkButton } from '@clossys/designer-ui';

/** The gallery title, its leaf count and one jump link per layer section. */
export function GalleryHeader({ count, layers }: { count: number; layers: readonly { id: string; label: string }[] }) {
  return <CardHeader>
    <CardTitle role="heading" aria-level={1} className="text-xl">Designer library</CardTitle>
    <CardDescription>{count === 1 ? '1 leaf' : `${count} leaves`} from the record store. Open a leaf for its contract, lineage and versions.</CardDescription>
    <CardDescription className="flex flex-wrap gap-1 pt-2">
      {layers.map(layer => <LinkButton key={layer.id} href={`#${layer.id}`} variant="outline" size="sm">{layer.label}</LinkButton>)}
    </CardDescription>
  </CardHeader>;
}
