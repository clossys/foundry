import { Badge, Card, CardContent, CardHeader, CardTitle, LinkButton } from '@clossys/designer-ui';
import type { GalleryCardData } from './types';

/** One L3 leaf: a view-only specimen thumbnail, name, version and status. The whole card is the link. */
export function LeafCard({ card }: { card: GalleryCardData }) {
  return <Card size="sm" className="relative">
    {card.specimenSrc
      ? <iframe inert title={`${card.name} specimen`} src={card.specimenSrc} width="100%" height="180" />
      : <CardContent><Badge variant="outline">No specimen</Badge></CardContent>}
    <CardHeader>
      <CardTitle>
        <LinkButton href={card.href} variant="link" className="h-auto p-0 text-base after:absolute after:inset-0">{card.name}</LinkButton>
      </CardTitle>
    </CardHeader>
    <CardContent className="flex items-center gap-2">
      {card.version !== undefined && <Badge variant="ghost">v{card.version}</Badge>}
      <Badge variant={card.statusTone}>{card.statusLabel}</Badge>
    </CardContent>
  </Card>;
}
