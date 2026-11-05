import { Avatar, AvatarFallback, Badge, Card, CardContent, CardHeader, CardTitle, Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@clossys/designer-ui';

/** One seat holder of the system: who it is, how it holds its steps, and how many it holds. All words are resolved Writer copy. */
export interface TeamCard {
  /** The roster id (`you`, an agent, `checks`, or `unassigned`); the map's lane of the same id. */
  id: string;
  name: string;
  /** The avatar fallback: the name's first letter. */
  initials: string;
  /** The seat kinds it holds steps as (You, AI, Code), as labels. */
  kinds: readonly string[];
  /** The AI tier its seats name, or the tier-open label; absent when it holds no AI step. */
  tier?: string;
  /** One line on what it does. */
  description: string;
  /** The number of steps it holds, as a label. */
  steps: string;
  /** Its lane on the workflow map (`?seat=<id>`). */
  href: string;
  /** The link's accessible name. */
  showLabel: string;
  /** Whether its lane is the one the map highlights. */
  active: boolean;
}

/** The `team` input of `sections.producer.team-strip`. */
export interface TeamStripInput { label: string; cards: readonly TeamCard[] }

/**
 * `sections.producer.team-strip`: the system's team in one stock Card. Each seat holder is one
 * stock outline Item linking to its lane on the map: a stock Avatar with its initial, its name and
 * one line on what it does, and stock Badges for its seat kinds, tier and step count. The holder
 * whose lane is highlighted shows the stock muted Item.
 */
export default function TeamStripSection({ team, ...provenance }: { team: TeamStripInput } & { [marker: `data-clossys-${string}`]: string }) {
  return <Card size="sm" {...provenance}>
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>{team.label}</CardTitle>
    </CardHeader>
    <CardContent>
      <ItemGroup>
        {team.cards.map(card => <Item key={card.id} href={card.href} variant={card.active ? 'muted' : 'outline'} size="sm" data-seat={card.id} aria-label={card.showLabel} {...(card.active ? { 'aria-current': 'true' as const } : {})}>
          <ItemMedia>
            <Avatar><AvatarFallback>{card.initials}</AvatarFallback></Avatar>
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{card.name}</ItemTitle>
            <ItemDescription>{card.description}</ItemDescription>
          </ItemContent>
          <ItemActions>
            {card.kinds.map(kind => <Badge key={kind} variant="secondary">{kind}</Badge>)}
            {card.tier ? <Badge variant="outline">{card.tier}</Badge> : null}
            <Badge variant="outline" data-steps>{card.steps}</Badge>
          </ItemActions>
        </Item>)}
      </ItemGroup>
    </CardContent>
  </Card>;
}
