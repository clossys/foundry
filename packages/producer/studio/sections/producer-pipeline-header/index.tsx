import { Card, CardDescription, CardHeader, CardTitle } from '@clossys/designer-ui';

/** Writer copy of the pipeline page header (studio.pipeline.title, studio.pipeline.description). */
export interface PipelineHeaderCopy {
  title: string;
  description: string;
}

/** The `header` input of `sections.producer.pipeline-header`. */
export interface PipelineHeaderInput { copy: PipelineHeaderCopy }

/** `sections.producer.pipeline-header`: the /producer/pipeline title and summary on a stock shadcn Card. */
export default function PipelineHeaderSection({ header, ...provenance }: { header: PipelineHeaderInput } & { [marker: `data-clossys-${string}`]: string }) {
  return <Card size="sm" {...provenance}>
    <CardHeader>
      <CardTitle role="heading" aria-level={1}>{header.copy.title}</CardTitle>
      <CardDescription>{header.copy.description}</CardDescription>
    </CardHeader>
  </Card>;
}
