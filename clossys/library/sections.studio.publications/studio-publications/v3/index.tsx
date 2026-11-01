import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, LinkButton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@clossys/designer-ui';

export interface PublicationsCopy {
  root: string;
  path: string;
  page: string;
  frame: string;
  sections: string;
  status: string;
  leaf: string;
  none: string;
}

export interface PublicationCopy { routeCount: string; routesLabel: string }

export type PublicationTone = 'secondary' | 'outline' | 'destructive';

/** One route of a publication: its served path, the page that renders it and how it is assembled. */
export interface PublicationRoute { key: string; path: string; pageId: string; frame: string; sections: readonly string[]; status: { label: string; tone: PublicationTone }; leaf?: { label: string; href: string } }

/** One publication: where it is served from (from its config, never assumed) and every route after that root. */
export interface Publication { id: string; title: string; root: string; rootNote: string; routes: readonly PublicationRoute[]; notice?: string }

/** The `publications` input of `sections.studio.publications`. */
export interface PublicationsInput { title: string; description: string; copy: PublicationsCopy; publications: readonly (Publication & { copy: PublicationCopy })[] }

/** `sections.studio.publications`: each publication's root and its full route table, one card per publication in the page column (no outer card). */
export default function PublicationsSection({ publications }: { publications: PublicationsInput }) {
  return <section data-studio-section="publications" aria-labelledby="publications-heading">
    <CardHeader className="px-0">
      <CardTitle id="publications-heading" role="heading" aria-level={2} className="text-xl">{publications.title}</CardTitle>
      <CardDescription>{publications.description}</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-6 px-0 pt-4">
      {publications.publications.map(publication => <Card key={publication.id} size="sm" id={`publication-${publication.id}`}>
        <CardHeader>
          <CardTitle role="heading" aria-level={3} className="flex flex-wrap items-center gap-2">
            {publication.title}
            <Badge variant="outline">{publication.copy.routeCount}</Badge>
          </CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-1">{publications.copy.root} <Badge variant="secondary">{publication.root}</Badge> {publication.rootNote}</CardDescription>
          {publication.notice && <CardDescription>{publication.notice}</CardDescription>}
        </CardHeader>
        <CardContent>
          <Table aria-label={publication.copy.routesLabel}>
            <TableHeader>
              <TableHead isRowHeader>{publications.copy.path}</TableHead>
              <TableHead>{publications.copy.page}</TableHead>
              <TableHead>{publications.copy.frame}</TableHead>
              <TableHead>{publications.copy.sections}</TableHead>
              <TableHead>{publications.copy.status}</TableHead>
              <TableHead>{publications.copy.leaf}</TableHead>
            </TableHeader>
            <TableBody>
              {publication.routes.map(route => <TableRow key={route.key} id={route.key}>
                <TableCell className="font-mono text-xs">{route.path}</TableCell>
                <TableCell className="font-mono text-xs">{route.pageId}</TableCell>
                <TableCell className="font-mono text-xs">{route.frame}</TableCell>
                <TableCell className="whitespace-normal font-mono text-xs">{route.sections.join(', ')}</TableCell>
                <TableCell><Badge variant={route.status.tone}>{route.status.label}</Badge></TableCell>
                <TableCell>{route.leaf ? <LinkButton href={route.leaf.href} variant="link" size="sm" className="h-auto px-0">{route.leaf.label}</LinkButton> : <Badge variant="ghost">{publications.copy.none}</Badge>}</TableCell>
              </TableRow>)}
            </TableBody>
          </Table>
        </CardContent>
      </Card>)}
    </CardContent>
  </section>;
}
