import { Badge, Card, CardContent, CardDescription, CardGrid, CardHeader, CardTitle, LinkButton } from '@clossys/designer-ui';

export type SlotTone = 'secondary' | 'outline' | 'destructive';

/** One slot card: the slot, its shown state and the route of its detail page. */
export interface SlotCard {
  id: string;
  name: string;
  href: string;
  statusLabel: string;
  statusTone: SlotTone;
  version?: number;
  excerpt: readonly string[];
}

/** One IA group of the active tab: its label and its slots, in IA order. */
export interface SlotGroup {
  id: string;
  label: string;
  cards: readonly SlotCard[];
}

/** The `groups` input of `sections.studio.slot-groups`. */
export interface SlotGroupsInput {
  empty: string;
  groups: readonly SlotGroup[];
}

/** `sections.studio.slot-groups`: the active tab's IA groups, stacked, each a grid of stock shadcn slot cards. */
export default function SlotGroupsSection({ groups }: { groups: SlotGroupsInput }) {
  return <CardContent data-studio-section="slot-groups" className="flex flex-col gap-8">
    {groups.groups.length ? groups.groups.map(group => <section key={group.id} id={group.id} aria-label={group.label}>
      <CardTitle role="heading" aria-level={2} className="pb-3">{group.label}</CardTitle>
      <CardGrid className="@xl/main:grid-cols-2 @5xl/main:grid-cols-3">
        {group.cards.map(card => <Card key={card.id} size="sm" data-slot-card={card.id}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <LinkButton href={card.href} variant="link" size="sm" className="h-auto px-0">{card.name}</LinkButton>
              {card.version ? <Badge variant="ghost">v{card.version}</Badge> : null}
              <Badge variant={card.statusTone}>{card.statusLabel}</Badge>
            </CardTitle>
            <CardDescription>{card.id}</CardDescription>
          </CardHeader>
          {card.excerpt.length ? <CardContent>{card.excerpt.map(line => <CardDescription key={line}>{line}</CardDescription>)}</CardContent> : null}
        </Card>)}
      </CardGrid>
    </section>) : <CardDescription>{groups.empty}</CardDescription>}
  </CardContent>;
}
