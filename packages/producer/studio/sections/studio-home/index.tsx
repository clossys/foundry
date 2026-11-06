import { Badge, Button, Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Field, FieldGroup } from '@clossys/designer-ui';

export type HomeTone = 'secondary' | 'outline' | 'destructive';

/** Counts come from the slot census, independently of gallery/renderer availability. */
export type HomeCensus =
  | { state: 'ready'; total: number; withCandidate: number; pinned: number }
  | { state: 'loading' }
  | { state: 'error'; message: string };

/** A census card's accessible count labels (Writer copy), for the census state the agent carries. */
export interface HomeCensusLabels { total: string; candidates: string; pinned: string }
/** One agent on Home. Navigation belongs to the shared frame; counts use the independent native census. */
export interface HomeAgent { id: string; label: string; purpose: string; icon: React.ReactNode; census?: HomeCensus; censusLabels: HomeCensusLabels; count?: { label: string; tone: HomeTone }; href: string; openLabel: string; openIcon?: React.ReactNode }
export interface HomeNeed { id: string; severity: string; tone: HomeTone; title: string; detail: string }

/** The `home` input of `sections.studio.home`. `needs` is present while the page's Needs module is open; the page head is `sections.studio.page-header`. */
export interface HomeInput {
  agentsLabel: string;
  agents: readonly HomeAgent[];
  needs?: { title: string; description: string; empty: string; rows: readonly HomeNeed[]; closeLabel: string; closeIcon?: React.ReactNode; onClose: () => void };
}

/**
 * `sections.studio.home`: the workspace's agents as stock shadcn census cards, side by side where
 * Home is wide enough, and the owner's open requests when Needs is open. Navigation stays in the shared frame.
 */
export default function HomeSection({ home, ...provenance }: { home: HomeInput } & { [marker: `data-clossys-${string}`]: string }) {
  return <CardContent {...provenance} role="region" aria-label={home.agentsLabel}>
    <CardTitle role="heading" aria-level={2}>{home.agentsLabel}</CardTitle>
    <FieldGroup>
      <Field orientation="responsive">
        {home.agents.map(agent => {
          const census = agent.census;
          const ready = census?.state === 'ready' ? census : undefined;
          return <Card key={agent.id} data-home-agent={agent.id} data-census-state={census?.state ?? 'missing'}>
            <CardHeader>
              <CardDescription>{agent.label}</CardDescription>
              <CardTitle aria-label={agent.censusLabels.total}>{ready ? ready.total : '—'}</CardTitle>
              <CardAction>
                <Badge variant="outline" aria-label={agent.censusLabels.candidates}>
                  {agent.icon}
                  {ready ? ready.withCandidate : '—'}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardFooter>
              <CardDescription>{agent.censusLabels.pinned} {census?.state === 'error' ? census.message : agent.purpose}</CardDescription>
            </CardFooter>
          </Card>;
        })}
      </Field>
    </FieldGroup>
    {home.needs && <Card size="sm">
      <CardHeader>
        <CardTitle>{home.needs.title}</CardTitle>
        <CardDescription>{home.needs.description}</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" aria-label={home.needs.closeLabel} onPress={home.needs.onClose}>
            {home.needs.closeIcon}
            {home.needs.closeLabel}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {home.needs.rows.length
          ? home.needs.rows.map(row => <CardDescription key={row.id}>
            <Badge variant={row.tone}>{row.severity}</Badge>
            <CardTitle>{row.title}</CardTitle>
            {row.detail}
          </CardDescription>)
          : <CardDescription>{home.needs.empty}</CardDescription>}
      </CardContent>
    </Card>}
  </CardContent>;
}
