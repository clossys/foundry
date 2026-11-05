import { Badge, CardDescription, CardHeader, CardTitle, LinkButton } from '@clossys/designer-ui';

export type LeafTone = 'secondary' | 'outline' | 'destructive';

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
  </CardHeader>;
}
