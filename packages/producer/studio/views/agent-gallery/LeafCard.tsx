import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, LinkButton, SpecimenFrame } from '@clossys/designer-ui';
import { LEAF_STATUS_LABEL, LEAF_STATUS_TONE } from '../../lib/leaf-status';
import type { GalleryCardData } from './types';

/** One L3 leaf: a view-only specimen (fixed-ratio thumbnail or text excerpt), name, version and status. The whole card is the link. */
export function LeafCard({ card }: { card: GalleryCardData }) {
  return <Card size="sm" className="relative">
    <CardContent className="flex flex-col gap-1">
      {card.specimenSrc
        ? <SpecimenFrame title={`${card.name} specimen`} src={card.specimenSrc} />
        : card.excerpt?.length
          ? card.excerpt.map((line, index) => <CardDescription key={index} className="line-clamp-3 break-words">{line}</CardDescription>)
          : card.specimenStatus
            ? <Badge variant={LEAF_STATUS_TONE[card.specimenStatus]}>{LEAF_STATUS_LABEL[card.specimenStatus]}</Badge>
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
      {card.badges?.map(badge => <Badge key={badge} variant="outline">{badge}</Badge>)}
    </CardContent>
  </Card>;
}
