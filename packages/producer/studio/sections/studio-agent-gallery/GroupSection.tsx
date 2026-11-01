import { CardDescription, CardTitle } from '@clossys/designer-ui';
import { LeafCard } from './LeafCard';
import type { GalleryGroupData } from './types';

/** An L1 or L2 group: an anchored heading and its leaf cards, one per row (an L1 over L2 groups carries only the heading). */
export function GroupSection({ group, unit }: { group: GalleryGroupData; unit: readonly [string, string] }) {
  const heading = `${group.id}-heading`;
  return <section id={group.id} aria-labelledby={heading}>
    <CardTitle id={heading} role="heading" aria-level={group.level + 2}>{group.label}</CardTitle>
    {group.cards.length > 0 && <>
      <CardDescription>{group.cards.length} {group.cards.length === 1 ? unit[0] : unit[1]}</CardDescription>
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6" data-layout="list">
        {group.cards.map(card => <LeafCard key={card.key} card={card} level={group.level + 3} />)}
      </div>
    </>}
  </section>;
}
