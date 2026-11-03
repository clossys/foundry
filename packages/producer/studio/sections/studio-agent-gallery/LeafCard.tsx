import { Badge, Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle, LinkButton, Skeleton } from '@clossys/designer-ui';
import { SpecimenContent } from '../studio-specimen';
import type { GalleryCardData } from './types';

/**
 * One L3 slot as a card: the header names it (a link to its L3 page) with its one state badge;
 * the body is the live preview of the shown state. An empty slot has no body, so its state
 * reads once. Options, history and contract stay on the slot page.
 */
export function LeafCard({ card, level }: { card: GalleryCardData; level: number }) {
  return <Card size="sm" data-gallery-leaf={card.key} data-state={card.state} className="min-w-0">
    <CardHeader>
      <CardTitle role="heading" aria-level={level}>
        <LinkButton href={card.href} variant="link" className="h-auto p-0 text-left whitespace-normal text-foreground">{card.name}</LinkButton>
      </CardTitle>
      <CardAction><Badge variant={card.statusTone}>{card.statusLabel}</Badge></CardAction>
    </CardHeader>
    {card.specimen
      ? <SpecimenContent specimen={card.specimen} />
      : card.specimenStatus?.loading
        ? <CardContent><Skeleton className="aspect-video w-full" aria-label={card.specimenStatus.label} /></CardContent>
        : card.specimenStatus && <CardContent><CardDescription data-preview-status="status">{card.specimenStatus.label}</CardDescription></CardContent>}
  </Card>;
}
