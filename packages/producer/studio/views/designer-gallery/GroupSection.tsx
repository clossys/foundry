import { CardContent, CardDescription, CardTitle } from '@clossys/designer-ui';
import { LeafCard } from './LeafCard';
import type { GalleryGroupData } from './types';

/** An L1 or L2 group: an anchored heading and its leaf cards (an L1 over L2 groups carries only the heading). */
export function GroupSection({ group }: { group: GalleryGroupData }) {
  const heading = `${group.id}-heading`;
  return <section id={group.id} aria-labelledby={heading}>
    <CardTitle id={heading} role="heading" aria-level={group.level + 2}>{group.label}</CardTitle>
    {group.cards.length > 0 && <>
      <CardDescription>{group.cards.length === 1 ? '1 leaf' : `${group.cards.length} leaves`}</CardDescription>
      <CardContent className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4 px-0 pt-3">
        {group.cards.map(card => <LeafCard key={card.key} card={card} />)}
      </CardContent>
    </>}
  </section>;
}
