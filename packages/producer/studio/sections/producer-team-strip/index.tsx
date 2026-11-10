import { Avatar, AvatarFallback, Badge, Card, CardContent, CardHeader, CardTitle, LinkButton, Tooltip, TooltipTrigger } from '@clossys/designer-ui';

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
  /** One line on what it does (the link's stock Tooltip). */
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
 * `sections.producer.team-strip`: the system's team in one compact stock Card. Each seat holder is one
 * small stock outline LinkButton to its lane on the map, set in one wrapping line: a small stock Avatar
 * with its initial, its name, and stock Badges for its seat kinds, tier and step count; its one line on
 * what it does is the link's stock Tooltip. The holder whose lane is highlighted shows the stock secondary
 * LinkButton.
 */
export default function TeamStripSection({ team, ...provenance }: { team: TeamStripInput } & { [marker: `data-clossys-${string}`]: string }) {
  return <Card size="sm" {...provenance}>
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>{team.label}</CardTitle>
    </CardHeader>
    <CardContent>
      {team.cards.map(card => [' ', <TooltipTrigger key={card.id}>
        <LinkButton href={card.href} variant={card.active ? 'secondary' : 'outline'} size="sm" data-seat={card.id} aria-label={card.showLabel} {...(card.active ? { 'aria-current': 'true' as const } : {})}>
        <Avatar size="sm"><AvatarFallback>{card.initials}</AvatarFallback></Avatar>
        {card.name}
        {card.kinds.map(kind => <Badge key={kind} variant="secondary">{kind}</Badge>)}
        {card.tier ? <Badge variant="outline">{card.tier}</Badge> : null}
        <Badge variant="outline" data-steps>{card.steps}</Badge>
        </LinkButton>
        <Tooltip>{card.description}</Tooltip>
      </TooltipTrigger>])}
    </CardContent>
  </Card>;
}
