import { CardContent, CardTitle } from '@clossys/designer-ui';
import { LeafCard } from './LeafCard';
import type { GallerySectionData } from './types';

/** An L2 group: an anchored heading over its slot cards in a grid that fills the width (cards at least 18rem; one column on a phone). */
export function GroupSection({ section }: { section: GallerySectionData }) {
  const heading = `${section.id}-heading`;
  return <section id={section.id} aria-labelledby={heading}>
    <CardTitle id={heading} role="heading" aria-level={2}>{section.label}</CardTitle>
    <CardContent className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-4 px-0 pt-4" data-layout="grid">
      {section.cards.map(card => <LeafCard key={card.key} card={card} level={3} />)}
    </CardContent>
  </section>;
}
