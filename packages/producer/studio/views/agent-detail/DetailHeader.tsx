import { Badge, CardDescription, CardHeader, CardTitle, LinkButton } from '@clossys/designer-ui';
import type { DetailHeaderData } from './types';

/** The leaf name, id, shown version, status and where it sits in the IA. */
export function DetailHeader({ header }: { header: DetailHeaderData }) {
  return <CardHeader>
    <CardDescription><LinkButton href={header.galleryHref} variant="link" size="sm" className="h-auto px-0">{header.galleryLabel}</LinkButton></CardDescription>
    <CardTitle role="heading" aria-level={1} className="flex flex-wrap items-center gap-2 text-xl">
      {header.name}
      {header.version !== undefined && <Badge variant="ghost">v{header.version}</Badge>}
      <Badge variant={header.statusTone}>{header.statusLabel}</Badge>
    </CardTitle>
    <CardDescription>{[header.id, ...header.trail].join(' · ')}</CardDescription>
    {header.statusDetail.map(line => <CardDescription key={line} className="max-w-(--measure)">{line}</CardDescription>)}
  </CardHeader>;
}
