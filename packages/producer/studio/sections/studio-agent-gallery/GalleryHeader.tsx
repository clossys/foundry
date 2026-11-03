import { Badge, CardAction, CardDescription, CardHeader, CardTitle } from '@clossys/designer-ui';
import type { GalleryHeaderData } from './types';

/** The agent name, its one-line purpose and how many of its slots are pinned. */
export function GalleryHeader({ header }: { header: GalleryHeaderData }) {
  return <CardHeader className="px-0">
    <CardTitle role="heading" aria-level={1} className="text-xl">{header.title}</CardTitle>
    <CardDescription>{header.description}</CardDescription>
    <CardAction><Badge variant="secondary" data-gallery-pinned="">{header.pinned}</Badge></CardAction>
    {header.notice && <CardDescription><Badge variant="outline">{header.notice}</Badge></CardDescription>}
  </CardHeader>;
}
