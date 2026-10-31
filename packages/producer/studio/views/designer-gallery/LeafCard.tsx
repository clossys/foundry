import { Badge, Card, CardContent, CardHeader, CardTitle, LinkButton, SpecimenFrame } from '@clossys/designer-ui';
import type { GalleryCardData } from './types';

/** One L3 leaf: a fixed-ratio specimen thumbnail, name, version and status. The whole card is the link. */
export function LeafCard({ card }: { card: GalleryCardData }) {
  return <Card size="sm" className="relative">
    <CardContent>
      {card.specimenSrc
        ? <SpecimenFrame title={`${card.name} specimen`} src={card.specimenSrc} />
        : <Badge variant="outline">No specimen</Badge>}
    </CardContent>
    <CardHeader>
      <CardTitle>
        <LinkButton href={card.href} variant="link" className="h-auto p-0 text-base whitespace-normal after:absolute after:inset-0">{card.name}</LinkButton>
      </CardTitle>
    </CardHeader>
    <CardContent className="flex flex-wrap items-center gap-2">
      {card.version !== undefined && <Badge variant="ghost">v{card.version}</Badge>}
      <Badge variant={card.statusTone}>{card.statusLabel}</Badge>
      {card.options > 0 && <Badge variant="outline">{card.options === 1 ? '1 option pending' : `${card.options} options pending`}</Badge>}
    </CardContent>
  </Card>;
}
