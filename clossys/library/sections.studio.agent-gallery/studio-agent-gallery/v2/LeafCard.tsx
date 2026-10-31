import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, LinkButton, SpecimenFrame } from '@clossys/designer-ui';
import type { GalleryCardData } from './types';

/**
 * One L3 leaf as a full-width row: a view-only specimen thumbnail (or text excerpt), the name,
 * the pinned version and one status signal. The whole card is the link.
 */
export function LeafCard({ card }: { card: GalleryCardData }) {
  return <Card size="sm" className="relative flex-row items-center" data-gallery-leaf={card.key}>
    <CardContent className="w-28 shrink-0 pr-0 sm:w-44">
      {card.specimenSrc
        ? <SpecimenFrame title={`${card.name} specimen`} src={card.specimenSrc} />
        : card.excerpt?.length
          ? <CardDescription className="line-clamp-4 text-xs break-words">{card.excerpt.join(' ')}</CardDescription>
          : <Badge variant="outline">{card.specimenStatus?.label ?? 'No specimen'}</Badge>}
    </CardContent>
    <CardHeader className="min-w-0 flex-1">
      <CardTitle>
        <LinkButton href={card.href} variant="link" className="h-auto p-0 text-left text-base whitespace-normal after:absolute after:inset-0">{card.name}</LinkButton>
      </CardTitle>
      <CardDescription className="flex flex-wrap items-center gap-2">
        {card.version !== undefined && <Badge variant="ghost">v{card.version}</Badge>}
        <Badge variant={card.statusTone}>{card.statusLabel}</Badge>
      </CardDescription>
    </CardHeader>
  </Card>;
}
