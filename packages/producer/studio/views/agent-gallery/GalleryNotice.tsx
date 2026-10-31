import { Card, CardDescription, CardHeader, CardTitle, Skeleton } from '@clossys/designer-ui';
import type { GalleryNoticeData } from './types';

/** Loading, empty and failed gallery or leaf states. */
export function GalleryNotice({ notice }: { notice?: GalleryNoticeData }) {
  if (!notice) return <Card className="m-4 md:m-6"><CardHeader><Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-64" /></CardHeader></Card>;
  return <Card className="m-4 md:m-6">
    <CardHeader>
      <CardTitle role="heading" aria-level={1}>{notice.title}</CardTitle>
      <CardDescription>{notice.description}</CardDescription>
    </CardHeader>
  </Card>;
}
