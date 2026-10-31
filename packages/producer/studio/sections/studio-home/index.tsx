import { Avatar, AvatarFallback, Badge, Button, Card, CardAction, CardContent, CardDescription, CardFooter, CardGrid, CardHeader, CardTitle, LinkButton, Skeleton } from '@clossys/designer-ui';

export type HomeTone = 'secondary' | 'outline' | 'destructive';

/** One agent on Home: what it does, how much it has written and where its library is. */
export interface HomeAgent { id: string; label: string; purpose: string; icon: React.ReactNode; count?: { label: string; tone: HomeTone }; href: string; openLabel: string; openIcon?: React.ReactNode }
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
 * The page body is the frame's column, so the section adds no outer card. Each agent card follows the
 * shadcn card anatomy: title and action badge in the header, purpose in the content, and the footer
 * pinned to the card bottom so every card in a row ends on one line.
 */
export default function HomeSection({ home }: { home: HomeInput }) {
  return <section data-studio-section="home" aria-labelledby="home-heading">
    <CardHeader className="px-0">
      <CardTitle id="home-heading" role="heading" aria-level={1} className="text-xl">{home.title}</CardTitle>
      <CardDescription className="max-w-(--measure)">{home.description}</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-4 px-0 pt-6">
      <CardTitle role="heading" aria-level={2} className="text-base">{home.agentsLabel}</CardTitle>
      <CardGrid>
        {home.agents.map(agent => <Card key={agent.id}>
          <CardHeader>
            <CardTitle className="flex items-center gap-3"><Avatar size="sm"><AvatarFallback>{agent.icon}</AvatarFallback></Avatar>{agent.label}</CardTitle>
            <CardAction>{agent.count ? <Badge variant={agent.count.tone} className="tabular-nums">{agent.count.label}</Badge> : <Skeleton className="h-5 w-14" />}</CardAction>
          </CardHeader>
          <CardContent><CardDescription>{agent.purpose}</CardDescription></CardContent>
          <CardFooter className="mt-auto"><LinkButton variant="outline" size="sm" href={agent.href}>{agent.openLabel}{agent.openIcon}</LinkButton></CardFooter>
        </Card>)}
      </CardGrid>
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
