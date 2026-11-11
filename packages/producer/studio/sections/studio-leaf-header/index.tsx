import { Badge, CardDescription, CardHeader, CardTitle, LinkButton } from '@clossys/designer-ui';

export type LeafTone = 'secondary' | 'outline' | 'destructive';

/** Where a shown status comes from: a run record (`<step>#<id>`) or a check id, and its result (Writer copy). */
export interface LeafCitation {
  source: string;
  result: string;
}

/** The `header` input of `sections.studio.leaf-header`: display-ready. */
export interface LeafHeaderInput {
  name: string;
  id: string;
  version?: number;
  /** The shown version as displayed (Writer copy), when there is one. */
  versionLabel?: string;
  statusLabel: string;
  statusTone: LeafTone;
  statusDetail: readonly string[];
  /** The run record or check result the status comes from; null when none ran, and the status then reads as not run. */
  citation: LeafCitation | null;
  trail: readonly string[];
  galleryHref: string;
  galleryLabel: string;
}

/** `sections.studio.leaf-header`: the leaf name, id, shown version, status and where it sits in the IA. */
export default function LeafHeaderSection({ header, ...provenance }: { header: LeafHeaderInput } & { [marker: `data-clossys-${string}`]: string }) {
  return <CardHeader {...provenance}>
    <CardDescription><LinkButton href={header.galleryHref} variant="link" size="sm">{header.galleryLabel}</LinkButton></CardDescription>
    <CardTitle role="heading" aria-level={1}>
      {header.name}
      {header.versionLabel && <Badge variant="ghost">{header.versionLabel}</Badge>}
      <Badge variant={header.statusTone}>{header.statusLabel}</Badge>
    </CardTitle>
    <CardDescription>{[header.id, ...header.trail].join(' · ')}</CardDescription>
    {header.statusDetail.map(line => <CardDescription key={line}>{line}</CardDescription>)}
    {header.citation && <CardDescription data-citation={header.citation.source}>{[header.citation.source, header.citation.result].join(' · ')}</CardDescription>}
  </CardHeader>;
}
