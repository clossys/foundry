import { Badge, Button, Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@clossys/designer-ui';

import type { HomeSlotCensus } from '../../lib/slot-census';

export type HomeTone = 'secondary' | 'outline' | 'destructive';

/** Counts come from the slot census, independently of gallery/renderer availability. */
export type HomeCensus = HomeSlotCensus;

/** One agent on Home. Navigation belongs to the shared frame; counts use the independent native census. */
export interface HomeAgent { id: string; label: string; purpose: string; icon: React.ReactNode; census?: HomeCensus; count?: { label: string; tone: HomeTone }; href: string; openLabel: string; openIcon?: React.ReactNode }
export interface HomeNeed { id: string; severity: string; tone: HomeTone; title: string; detail: string }

/** The `home` input of `sections.studio.home`. `needs` is present while the page's Needs module is open. */
export interface HomeInput {
  title: string;
  description: string;
  agentsLabel: string;
  agents: readonly HomeAgent[];
  needs?: { title: string; description: string; empty: string; rows: readonly HomeNeed[]; closeLabel: string; closeIcon?: React.ReactNode; onClose: () => void };
}

/**
 * `sections.studio.home`: the workspace's agents, and the owner's open requests when Needs is open.
 * Agent cards extract dashboard-01 SectionCards. See ../studio-specimen/stock-layout.provenance.json for the
 * exact source and the unqualified data-binding boundary. Navigation stays in the shared frame.
 */
export default function HomeSection({ home }: { home: HomeInput }) {
  return <section data-studio-section="home" aria-labelledby="home-heading">
    <CardHeader className="px-0">
      <CardTitle id="home-heading" role="heading" aria-level={1} className="text-xl">{home.title}</CardTitle>
      <CardDescription>{home.description}</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-4 px-0 pt-6">
      <CardTitle role="heading" aria-level={2} className="text-base">{home.agentsLabel}</CardTitle>
      <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
        {home.agents.map(agent => {
          const census = agent.census;
          const ready = census?.state === 'ready' ? census : undefined;
          const status = census?.state === 'loading' ? 'Loading' : 'Unavailable';
          return <Card key={agent.id} className="@container/card" data-home-agent={agent.id} data-census-state={census?.state ?? 'missing'}>
            <CardHeader>
              <CardDescription>{agent.label}</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl" aria-label={ready ? `${ready.total} slots` : `${agent.label} slot census ${status.toLowerCase()}`}>
                {ready ? ready.total : '—'}
              </CardTitle>
              <CardAction>
                <Badge variant="outline" aria-label={ready ? `${ready.withCandidate} slots with candidates` : status}>{ready ? ready.withCandidate : '—'}</Badge>
              </CardAction>
            </CardHeader>
            <CardFooter className="flex-col items-start gap-1.5 text-sm">
              <div className="line-clamp-1 flex gap-2 font-medium">{ready ? `${ready.pinned} pinned slots` : status}{' '}{agent.icon}</div>
              <div className="text-muted-foreground">{census?.state === 'error' ? census.message : agent.purpose}</div>
            </CardFooter>
          </Card>;
        })}
      </div>
      {home.needs && <Card size="sm">
        <CardHeader>
          <CardTitle>{home.needs.title}</CardTitle>
          <CardDescription>{home.needs.description}</CardDescription>
          <CardAction><Button variant="ghost" size="icon-xs" aria-label={home.needs.closeLabel} onPress={home.needs.onClose}>{home.needs.closeIcon}</Button></CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {home.needs.rows.length
            ? home.needs.rows.map(row => <CardDescription key={row.id} className="flex flex-col items-start gap-1">
              <Badge variant={row.tone}>{row.severity}</Badge>
              <CardTitle className="text-sm">{row.title}</CardTitle>
              {row.detail}
            </CardDescription>)
            : <CardDescription>{home.needs.empty}</CardDescription>}
        </CardContent>
      </Card>}
    </CardContent>
  </section>;
}
