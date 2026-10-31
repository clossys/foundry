import { Card, CardDescription, CardHeader, CardTitle, Skeleton } from '@clossys/designer-ui';

/** A loading, empty or failed page: a title and why. */
export interface PageNoticeData { title: string; description: string }

/** Loading (no notice), empty and failed page states, inside the frame's content column. */
export function PageNotice({ notice }: { notice?: PageNoticeData }) {
  if (!notice) return <Card role="status" aria-label="Loading page"><CardHeader><Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-64" /></CardHeader></Card>;
  return <Card>
    <CardHeader>
      <CardTitle role="heading" aria-level={1}>{notice.title}</CardTitle>
      <CardDescription>{notice.description}</CardDescription>
    </CardHeader>
  </Card>;
}
