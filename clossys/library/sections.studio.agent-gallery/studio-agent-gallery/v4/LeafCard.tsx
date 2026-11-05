import { Badge, Card, CardAction, CardContent, CardHeader, CardTitle, LinkButton, Skeleton } from '@clossys/designer-ui';
import { SpecimenContent } from '../studio-specimen';
import type { GalleryCardData } from './types';

/**
 * One L3 leaf as a full-width card: the header names it (a link to its L3 page) with the pinned
 * version and one status signal; the body is the full live preview of its active state, the same
 * specimen body the leaf page places. Options, history and contract stay on the leaf page.
 */
export function LeafCard({ card, level }: { card: GalleryCardData; level: number }) {
  return <Card size="sm" data-gallery-leaf={card.key}>
    <CardHeader>
      <CardTitle role="heading" aria-level={level}>
        <LinkButton href={card.href} variant="link" className="h-auto p-0 text-left text-base whitespace-normal">{card.name}</LinkButton>
      </CardTitle>
      <CardAction className="flex items-center gap-2">
        {card.version !== undefined && <Badge variant="ghost">v{card.version}</Badge>}
        <Badge variant={card.statusTone}>{card.statusLabel}</Badge>
      </CardAction>
    </CardHeader>
    {card.specimen
      ? <SpecimenContent specimen={card.specimen} />
      : card.specimenStatus?.loading
        ? <CardContent><Skeleton className="aspect-(--specimen-ratio-desktop) w-full" aria-label={card.specimenStatus.label} /></CardContent>
        : <CardContent><Badge variant={card.specimenStatus?.tone ?? 'outline'} data-preview-status="status">{card.specimenStatus?.label}</Badge></CardContent>}
  </Card>;
}
