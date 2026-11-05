import { Badge, Card, CardContent, CardDescription, CardTitle, HomeStockGrid, HomeStockCensusCard, HomeStockNeedsHeader } from '@clossys/designer-ui';

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
 * `sections.studio.home`: the workspace's agents, and the owner's open requests when Needs is open.
 * Home-specific Designer parts carry exact stock source proof; this section binds display-ready data.
 * Canonical candidate qualification remains separate. Navigation stays in the shared frame.
 */
export default function HomeSection({ home, ...provenance }: { home: HomeInput } & { [marker: `data-clossys-${string}`]: string }) {
  return <section {...provenance} aria-label={home.agentsLabel}>
    <CardContent>
      <CardTitle role="heading" aria-level={2}>{home.agentsLabel}</CardTitle>
      <HomeStockGrid>
        {home.agents.map(agent => {
          const census = agent.census;
          const ready = census?.state === 'ready' ? census : undefined;
          return <HomeStockCensusCard key={agent.id} id={agent.id} state={census?.state ?? 'missing'}
            label={agent.label} total={ready ? ready.total : '—'}
            totalLabel={agent.censusLabels.total}
            candidates={ready ? ready.withCandidate : '—'} candidatesLabel={agent.censusLabels.candidates}
            pinnedLabel={agent.censusLabels.pinned} icon={agent.icon}
            detail={census?.state === 'error' ? census.message : agent.purpose} />;
        })}
      </HomeStockGrid>
      {home.needs && <Card size="sm">
        <HomeStockNeedsHeader title={home.needs.title} description={home.needs.description}
          closeLabel={home.needs.closeLabel} closeIcon={home.needs.closeIcon} onClose={home.needs.onClose} />
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
    </CardContent>
  </section>;
}
